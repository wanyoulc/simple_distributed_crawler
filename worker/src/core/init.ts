import { Channel, ConsumeMessage } from "amqplib";
import { HeartBeatMessage, NodeType } from "../types/rabbitmq";
import {
  HeartBeatMessageQueue,
  MessageQueue,
  MockStateMQ,
  MockTaskMQ,
  TimerMessageQueue,
  URLMessageQueue,
} from "./messageQueue";
import { MongoConnectionManager, RedisConnectionManager } from "./db";
import { bytesToGB, getFormattedDate, sleep } from "../lib/utils";
import { cpuFree, cpuUsage } from "os-utils";
import { freemem, totalmem } from "os";
import { readFileSync } from "fs";

import EventEmitter from "events";
import EventNames from "../types/events";
import address from "address";
import commandLineArgs from "command-line-args";
import logHandler from "../exceptions/logHandler";
import logLevel from "../types/log";
import taskManager from "./taskManager";
import tasksChain from "./tasksCahin";
import { v4 as uuidv4 } from "uuid";
import { LoadBalancingStrategy } from "../types/task";

class InitManager {
  static mongo: MongoConnectionManager;
  static urlMQ: URLMessageQueue;
  static workerHBMQ: HeartBeatMessageQueue;
  static workerHBTimerMQ: TimerMessageQueue;
  static redis: RedisConnectionManager;
  static eventCenter: EventEmitter.EventEmitter;
  static uuid: string;
  static ip: string;
  static cpuUsage: number;
  static cpuFree: number;
  static currentTasksNumber?: number = 0;

  private constructor() {}

  static async init() {
    global.resourceManager = InitManager;
    this.ip = address.ip();
    this.uuid = uuidv4();
    this.storeCPUMessage();
    this.initEventCenter();
    try {
      await Promise.all([this.initDB(), this.initMQ(), this.initRedis()]);
    } catch (e) {
      console.log(e);
    }
    await this.urlMQ.registerGetter();
  }

  static storeCPUMessage() {
    setInterval(() => {
      cpuFree((percentage: number) => {
        this.cpuFree = percentage;
      });
      cpuUsage((percentage: number) => {
        this.cpuUsage = percentage;
      });
    }, 100);
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

    this.workerHBTimerMQ = await TimerMessageQueue.initTimer(
      "workerHBTimer",
      { messageTtl: 2000 },
      async (channel, msg) => {
        let totalMem = totalmem();
        let freeMem = freemem();

        if (process.env.NODE_ENV === "docker") {
          totalMem = Number(
            readFileSync(
              "/sys/fs/cgroup/memory/memory.limit_in_bytes"
            ).toString()
          );
          freeMem =
            totalMem -
            Number(
              readFileSync(
                "/sys/fs/cgroup/memory/memory.usage_in_bytes"
              ).toString()
            );
        }

        const heartBeat = new HeartBeatMessage(
          NodeType.worker,
          new Date().getTime(),
          getFormattedDate(),
          this.uuid,
          this.ip,
          this.cpuFree,
          this.cpuUsage,
          bytesToGB(totalMem),
          bytesToGB(freeMem),
          taskManager.getTasks()
        );
        await this.workerHBMQ.put(heartBeat);
        channel.ack(msg);
      }
    );
  }

  static initEventCenter() {
    class EventCenter extends EventEmitter.EventEmitter {}
    const eventCenter = new EventCenter();
    this.eventCenter = eventCenter;
    this.eventCenter.on(
      EventNames.newURL,
      async function (channel: Channel, urlMsg: ConsumeMessage) {
        await tasksChain(urlMsg.content.toString());
        channel.ack(urlMsg);
      }
    );
    this.eventCenter.on(
      EventNames.log,
      function (level: logLevel, message: string, err?: Error) {
        logHandler(level, message, err);
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

  static async initMock(mockOptions: commandLineArgs.CommandLineOptions) {
    const loadBalancingStrategy = await this.redis.connection.get(
      "load_balancing_strategy"
    );
    let mockTaskMQ: MockTaskMQ;
    if (
      loadBalancingStrategy === LoadBalancingStrategy.ROUND_ROBIN ||
      loadBalancingStrategy === LoadBalancingStrategy.RB ||
      loadBalancingStrategy === LoadBalancingStrategy.CURREENT_PROCESSING_NUM ||
      loadBalancingStrategy === LoadBalancingStrategy.CPN
    ) {
      mockTaskMQ = await MockTaskMQ.init<MockTaskMQ>(
        `mockTask_${this.uuid}`,
        undefined,
        this.uuid,
        "topic"
      );
    } else if (
      loadBalancingStrategy === LoadBalancingStrategy.PROCESSING_SPEED_FIRST ||
      loadBalancingStrategy === LoadBalancingStrategy.PSF
    ) {
      mockTaskMQ = await MockTaskMQ.init<MockTaskMQ>("mockTask");
    } else {
      // actually it's an unused condition
      mockTaskMQ = await MockTaskMQ.init<MockTaskMQ>("mockTask");
    }

    const mockStateMQ = await MockStateMQ.init<MockStateMQ>("mockState");
    const factor = mockOptions.factor;
    await mockTaskMQ.registerGetter({ precount: 50 });
    let processedTasksNumber = 0;
    let totalProcessingTime = 0;
    this.eventCenter.on(
      EventNames.newMockTask,
      (channel: Channel, msg: ConsumeMessage) => {
        const startTime = new Date().getTime();
        const mockTask = JSON.parse(msg.content.toString());
        if (!mockTask.async) {
          const processingTime = mockTask.processingTime;
          sleep(factor * processingTime);
        }
        const stopTime = new Date().getTime();
        processedTasksNumber += 1;
        totalProcessingTime += stopTime - startTime;

        console.log(`Processed Task: ${mockTask.taskID}`);
        console.log(`Processed Task Number: ${processedTasksNumber}`);
        console.log(`Total Processing Time: ${totalProcessingTime}`);
        console.log("------------------------------------------");

        channel.ack(msg);

        mockStateMQ.put({
          uuid: InitManager.uuid,
          processedTasksNumber,
          totalProcessingTime,
        });
        const taskName = "mock";
        const previousTask = taskManager.getTask(taskName);
        taskManager.updateTask(taskName, {
          taskQueue: previousTask.taskQueue,
          taskQueueCfg: previousTask.taskQueueCfg,
          unackedNumber: previousTask.unackedNumber - 1,
          processingSpeed: totalProcessingTime / processedTasksNumber,
        });
      }
    );
  }
}

export default InitManager;
