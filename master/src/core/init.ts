import {
  HeartBeatMessageQueue,
  LoadBalancingMQ,
  MessageQueue,
  MockStateMQ,
  MockTaskMQ,
  TimerMessageQueue,
  URLMessageQueue,
} from "./messageQueue";
import { MongoConnectionManager, RedisConnectionManager } from "./db";
import { NodeTable, node } from "../types/node";
import amqp, { Channel, ConsumeMessage } from "amqplib";

import EventEmitter from "events";
import EventNames from "../types/events";
import { LoadBalancingStrategy } from "../types/task";
import { MockStateMessage } from "../types/rabbitmq";
import Router from "koa-router";
import address from "address";
import axios from "axios";
import commandLineArgs from "command-line-args";
import config from "../config";
import crawlerRouter from "../api/crawler";
import { getLoadBalancingWeight } from "../lib/utils";
import logHandler from "../exceptions/logHandler";
import logLevel from "../types/log";
import util from "util";
import { v4 as uuidv4 } from "uuid";
import { writeFileSync } from "fs";
import path from "path";
import { ask } from "stdio";

class InitManager {
  static mongo: MongoConnectionManager;
  static urlMQ: URLMessageQueue;
  static workerHBMQ: HeartBeatMessageQueue;
  static loadbalancingConfigMQ: LoadBalancingMQ;
  static loadbalancingConfigTimerMQ: TimerMessageQueue;
  static loadbalancingStrategy: LoadBalancingStrategy;
  static redis: RedisConnectionManager;
  static eventCenter: EventEmitter.EventEmitter;
  static routers: Router[];
  static uuid: string;
  static ip: string;
  static nodeTable: NodeTable;
  static deletedQueues: string[];

  private constructor() {}

  static async init() {
    global.resourceManager = InitManager;
    this.uuid = uuidv4();
    this.ip = address.ip();
    this.loadbalancingStrategy = LoadBalancingStrategy.ROUND_ROBIN;
    this.initNodeTable();
    this.initEventCenter();
    this.initRouter();
    try {
      await Promise.all([this.initDB(), this.initMQ(), this.initRedis()]);
    } catch (e) {
      console.log(e);
    }
    await Promise.all([this.workerHBMQ.registerGetter()]);
    setInterval(this.updateNodeTable.bind(this), 1000);
  }

  static async initDB() {
    this.mongo = await MongoConnectionManager.init();
  }

  static async initRedis() {
    this.redis = await RedisConnectionManager.init();
  }

  static async initMQ() {
    this.urlMQ = await URLMessageQueue.init("URL");
    this.workerHBMQ = await HeartBeatMessageQueue.init(
      "workerHB",
      {},
      "workerHB"
    );
  }

  static initRouter() {
    this.routers = [];
    this.routers.push(crawlerRouter);
  }

  static initEventCenter() {
    class EventCenter extends EventEmitter.EventEmitter {}
    const eventCenter = new EventCenter();
    this.eventCenter = eventCenter;
    // this.eventCenter.on("newUrl", function(url) {
    //     tasksChain(url);
    // });

    this.eventCenter.on(
      EventNames.log,
      function (level: logLevel, message: string | object, err?: Error) {
        logHandler(level, message, err);
      }
    );
    this.eventCenter.on(
      EventNames.newHeartBeat,
      function (channel: amqp.Channel, heartBeatMsg: amqp.ConsumeMessage) {
        const {
          nodeType,
          uuid,
          ip,
          timestamp,
          formattedDate,
          cpuFree,
          cpuUsage,
          freemem,
          totalmem,
          task,
        } = JSON.parse(heartBeatMsg.content.toString());
        const nodeProps: node = {
          nodeType,
          uuid,
          ip,
          lastActived: timestamp,
          formattedLastActived: formattedDate,
          cpuFree,
          cpuUsage,
          freemem,
          totalmem,
          task,
        };
        global.resourceManager.nodeTable[uuid] = nodeProps;
        channel.ack(heartBeatMsg);
      }
    );
    process.on("uncaughtException", function (err) {
      console.error("uncaughtException!");
      logHandler("ERROR", err.message, err);
    });
    // process.on('unhandledRejection', function(reason){
    //     console.error('unhandledRejection!')
    //     logHandler('ERROR',  reason!.toString())
    // })
  }

  static initNodeTable() {
    const nodeTable = (this.nodeTable = {});
    Object.defineProperty(nodeTable, "size", {
      get: function () {
        return Object.keys(nodeTable).length;
      },
    });
  }

  static updateNodeTable() {
    const curDate = new Date();
    Object.keys(this.nodeTable).forEach((uuid) => {
      const interval = curDate.getTime() - this.nodeTable[uuid].lastActived;
      if (interval > config.updateNodeInterval) {
        delete this.nodeTable[uuid];
      }
    });
    writeFileSync(
      path.resolve("../master", "node-table.json"),
      JSON.stringify(this.nodeTable)
    );
  }

  static async initMock(mockOptions: commandLineArgs.CommandLineOptions) {
    this.loadbalancingStrategy = mockOptions.strategy;
    let putMockTask: Function;
    let startingTaskID = 0;
    if (
      this.loadbalancingStrategy ===
        LoadBalancingStrategy.PROCESSING_SPEED_FIRST ||
      this.loadbalancingStrategy === LoadBalancingStrategy.PSF
    ) {
      const mockTaskMQ = await MockTaskMQ.init<MockTaskMQ>("mockTask");
      putMockTask = async () => {
        await Promise.all(
          Array(mockOptions.taskNumber)
            .fill(0)
            .map((_, index) =>
              mockTaskMQ.put({
                processingTime: Math.random() * 100,
                async: mockOptions.async,
                taskID: index + startingTaskID,
              })
            )
        );
        startingTaskID += mockOptions.taskNumber;
      };
    } else {
      const channel = MessageQueue.getChannel();
      const mockTaskEX = await channel.assertExchange("MockTaskEX", "topic", {
        durable: false,
      });

      if (
        this.loadbalancingStrategy === LoadBalancingStrategy.ROUND_ROBIN ||
        this.loadbalancingStrategy === LoadBalancingStrategy.RB
      ) {
        const workerUUIDs = Object.keys(this.nodeTable);
        const weightString = await ask("please input the weight");
        const weight = weightString
          .split(/\s+/)
          .map((weight) => Number(weight));
        const weightSum = weight.reduce((prev, acc) => {
          return acc + prev;
        }, 0);
        const weightTable: string[] = [];
        let weightTableCursor = 0;
        weight.forEach((w, i) => {
          for (let j = 0; j < w; j++) {
            weightTable[weightTableCursor] = workerUUIDs[i];
            weightTableCursor++;
          }
        });
        putMockTask = async () => {
          await Promise.all(
            Array(mockOptions.taskNumber)
              .fill(0)
              .map((_, index) => {
                const currentNodeIndex = index % weightSum;
                if (
                  Number(
                    InitManager.nodeTable[weightTable[currentNodeIndex]].freemem
                  ) /
                    Number(
                      InitManager.nodeTable[weightTable[currentNodeIndex]]
                        .totalmem
                    ) <
                  0.1
                ) {
                  return;
                }
                return channel.publish(
                  mockTaskEX.exchange,
                  weightTable[currentNodeIndex],
                  Buffer.from(
                    JSON.stringify({
                      processingTime: Math.random() * 100,
                      async: mockOptions.async,
                      taskID: index + startingTaskID,
                    })
                  )
                );
              })
          );
        };
      } else if (
        this.loadbalancingStrategy ===
          LoadBalancingStrategy.CURREENT_PROCESSING_NUM ||
        this.loadbalancingStrategy === LoadBalancingStrategy.CPN
      ) {
        putMockTask = async () => {};
      } else {
        putMockTask = async () => {};
      }
    }

    await putMockTask();
    setInterval(async () => {
      startingTaskID += mockOptions.taskNumber;
      await putMockTask();
    }, 30000);

    const mockStateMQ = await MockStateMQ.init<MockStateMQ>("mockState");
    const mockStateTable: Record<string, Omit<MockStateMessage, "uuid">> = {};
    await mockStateMQ.registerGetter();

    this.eventCenter.on(
      EventNames.mockState,
      (channel: Channel, msg: ConsumeMessage) => {
        const mockState: MockStateMessage = JSON.parse(msg.content.toString());
        mockStateTable[mockState.uuid] = {
          processedTasksNumber: mockState.processedTasksNumber,
          totalProcessingTime: mockState.totalProcessingTime,
        };
        channel.ack(msg);
      }
    );
  }
}

export default InitManager;
