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
    // setInterval(this.updateNodeTable.bind(this), 1000);
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
    // this.loadbalancingConfigMQ = await LoadBalancingMQ.init(
    //   "loadbalancingConfig"
    // );
    // this.loadbalancingConfigTimerMQ = await TimerMessageQueue.initTimer(
    //   "loadbalancingConfigTimer",
    //   { messageTtl: 2000 },
    //   async (channel, msg) => {
    //      if (this.loadbalancingStrategy === LoadBalancingStrategy.PROCESSING_SPEED_FIRST || 'psf'){
    //          const messageNumbers = Object.values(this.nodeTable).reduce((acc, node) => {
    //              Object.keys(node.task).forEach(async t => {
    //                  if(!acc[t]) {
    //                      acc[t] = (
    //                        await axios.get(
    //                          "http://localhost:15672/api/queues/%2F/mockTask",
    //                          {
    //                            auth: {
    //                              username: "guest",
    //                              password: "guest",
    //                            },
    //                          }
    //                        )
    //                      ).data.backing_queue_status.len
    //                  }
    //              })
    //              return acc
    //          }, {} as Record<string,number>)
    //          const loadBalancingWeight = getLoadBalancingWeight(this.nodeTable, messageNumbers)
    //          console.log("load-balancing: ", util.inspect(loadBalancingWeight, {
    //             showHidden: false,
    //             depth: null,
    //           })
    //         )
    //          await this.loadbalancingConfigMQ.put(loadBalancingWeight)
    //          channel.ack(msg)
    //      }
    //   },
    //   true
    // );
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
    this.eventCenter.emit(EventNames.log, "INFO", this.nodeTable);
    const curDate = new Date();
    Object.keys(this.nodeTable).forEach((uuid) => {
      const interval = curDate.getTime() - this.nodeTable[uuid].lastActived;
      if (interval > config.updateNodeInterval) {
        this.eventCenter.emit(
          EventNames.log,
          "INFO",
          `child node ${uuid} has deactived`
        );
        delete this.nodeTable[uuid];
      }
    });
  }

  static async initMock(mockOptions: commandLineArgs.CommandLineOptions) {
    this.loadbalancingStrategy = mockOptions.strategy;
    if (
      this.loadbalancingStrategy ===
        LoadBalancingStrategy.PROCESSING_SPEED_FIRST ||
      this.loadbalancingStrategy === LoadBalancingStrategy.PSF
    ) {
      const mockTaskMQ = await MockTaskMQ.init<MockTaskMQ>("mockTask");
      await Promise.all(
        Array(mockOptions.taskNumber)
          .fill(0)
          .map((_, index) =>
            mockTaskMQ.put({
              processingTime: Math.random() * 100,
              async: mockOptions.async,
              taskID: index
            })
          )
      );
    } else {
      const channel = MessageQueue.getChannel();
      const mockTaskEX = await channel.assertExchange(
        "MockTaskEX",
        "topic",
        {
          durable: false,
        }
      );

      if (
        this.loadbalancingStrategy === LoadBalancingStrategy.ROUND_ROBIN ||
        this.loadbalancingStrategy === LoadBalancingStrategy.RB
      ) {
        const workerUUIDs = Object.keys(this.nodeTable);
        let currentNodeIndex = 0;
        await Promise.all(
          Array(mockOptions.taskNumber)
            .fill(0)
            .map((_, index) => {
              const currentNodeIndex = index % workerUUIDs.length;
              return channel.publish(
                mockTaskEX.exchange,
                workerUUIDs[currentNodeIndex],
                Buffer.from(
                  JSON.stringify({
                    processingTime: Math.random() * 100,
                    async: mockOptions.async,
                    taskID: index
                  })
                )
              );
            })
        );
      } else if (
        this.loadbalancingStrategy ===
          LoadBalancingStrategy.CURREENT_PROCESSING_NUM ||
        this.loadbalancingStrategy === LoadBalancingStrategy.CPN
      ) {
        
      }
    }

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
        console.log(mockStateTable);
        channel.ack(msg);
      }
    );
    // let startTime = 0;
    // let endTime = 0;
    // const monitor = async () => {
    //   const queueState = (
    //     await axios.get("http://localhost:15672/api/queues/%2F/mockTask", {
    //       auth: {
    //         username: "guest",
    //         password: "guest",
    //       },
    //     })
    //   ).data;
    //   console.log(queueState.idle_since);
    //   if (startTime === 0 && !queueState.idle_since) {
    //     console.log('start')
    //     startTime = new Date().getTime();
    //   }
    //   if (endTime === 0 && startTime !== 0 && queueState.idle_since) {
    //     endTime = new Date().getTime();
    //     console.log('end')
    //     this.eventCenter.emit("mockEnd");
    //   }
    // };
    // this.eventCenter.on("mockEnd", () => {
    //   console.log({
    //     ...mockStateTable,
    //     totalProcessedTasksNumber: Object.values(mockStateTable).reduce(
    //       (acc, cur) => {
    //         return acc + cur.processedTasksNumber;
    //       },
    //       0
    //     ),
    //   });
    //   clearInterval(timeout);
    // });
    // const timeout = setInterval(async () => {
    //   await monitor();
    // }, 100);
  }
}

export default InitManager;
