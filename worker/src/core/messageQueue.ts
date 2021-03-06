import {
  HeartBeatMessage,
  LoadBalancingMessage,
  MQSchemaTypes,
  MockStateMessage,
  MockTaskMessage,
  TimerMessage,
  exchangeType,
  messageQueue,
  messageQueueCfg,
} from "../types/rabbitmq";

import EventNames from "../types/events";
import { MQParamException } from "../exceptions/exception";
import amqp from "amqplib";
import config from "../config/index";
import { merge } from "lodash";
import taskManager from "./taskManager";
import { v4 as uuidv4 } from "uuid";

import {PartialBy} from '../types/common'

type Constructor<T> = {
  new (...args: any[]): T;
};

const mqSchemas = new Map<MQSchemaTypes, Constructor<MessageQueue>>();

function addToMQSchemas(
  constructor: Constructor<MessageQueue> & { schemaName: string }
) {
  mqSchemas.set(Object.getPrototypeOf(constructor).schemaName, constructor);
}

function getMQSchema(config: messageQueueCfg) {
  return class extends MessageQueue implements messageQueue {
    exchangeName = config.exchangeName;
    exchangeType: exchangeType = config.exchangeType || "direct";
    exchangeCfg: amqp.Options.AssertExchange = config.exchangeCfg || {};
    queueCfg: amqp.Options.AssertQueue = config.queueCfg || {};
    pubCfg: amqp.Options.Publish = config.pubCfg || {};
    subCfg: amqp.Options.Consume = config.subCfg || {};
    queueName = config.queueName || "";
    routingKey = config.routingKey || "";

    static schemaName = config.schemaName;

    constructor(
      queueName: string,
      queueCfg?: amqp.Options.AssertQueue,
      routingKey?: string
    ) {
      super();
      if (queueCfg) {
        this.queueCfg = queueCfg;
      }
      if (routingKey) {
        this.routingKey = routingKey;
      }
      this.mergeOptions();
      this.queueName = queueName;
    }

    // 实例化子类的入口函数
    static async init<T extends MessageQueue>(
      queueName: string,
      queueCfg?: amqp.Options.AssertQueue,
      routingKey?: string,
      exchangeType ?: string,
      exchangeCfg ?: amqp.Options.AssertExchange
    ): Promise<T> {
      const schema = mqSchemas.get(config.schemaName);
      if (!schema) {
        throw new Error(`schema ${this.schemaName} is not registered`);
      }
      const instance = await (schema as any).baseInit(
        queueName,
        queueCfg,
        routingKey
      );
      await instance.initExchange(exchangeType, exchangeCfg);
      await instance.initQueue();
      return instance;
    }

    async put(message: unknown): Promise<void> {}
    async registerGetter(getterCfg?: { precount: number }): Promise<void> {}

    protected async registerGetterAndEmitEvent(
      eventName: string,
      getterCfg?: { precount: number }
    ): Promise<void> {
      const channel = MessageQueue.channel;
      if (getterCfg?.precount) {
        channel.prefetch(getterCfg.precount);
      }
      await channel.consume(
        this.queueName,
        (msg) => {
          if (msg) {
            global.resourceManager.eventCenter.emit(eventName, channel, msg);
          } else {
            console.warn("consumer was cancelled");
          }
        },
        this.subCfg
      );
    }
    protected async publish(message: string): Promise<void> {
      MessageQueue.channel.publish(
        this.exchangeName,
        this.routingKey,
        Buffer.from(message),
        this.pubCfg
      );
    }
  };
}

abstract class MessageQueue {
  protected static connection: amqp.Connection;
  protected static channel: amqp.Channel;
  public baseExchangeCfg: amqp.Options.AssertExchange;
  public baseQueueCfg: amqp.Options.AssertQueue;
  public basePubCfg: amqp.Options.Publish;
  public baseSubCfg: amqp.Options.Consume;

  constructor() {
    this.baseExchangeCfg = {
      durable: false,
    };

    this.baseQueueCfg = {
      durable: false,
    };

    this.basePubCfg = {
      persistent: false,
    };
    this.baseSubCfg = {};
  }

  //   init MQ instance
  protected static async baseInit<T extends MessageQueue>(
    this: new (
      queueName: string,
      queueCfg?: amqp.Options.AssertQueue,
      routingKey?: string
    ) => T,
    queueName: string,
    queueCfg: amqp.Options.AssertQueue | undefined,
    routingKey: string | undefined
  ): Promise<T> {
    if (!MessageQueue.connection) {
      const connection = await amqp.connect(config.rabbitMQAddress);
      const channel = await connection.createChannel();
      MessageQueue.connection = connection;
      MessageQueue.channel = channel;
    }
    return new this(queueName, queueCfg, routingKey);
  }

  protected async initExchange<T extends messageQueue>(this: T, exchangeType ?: string ,exchangeCfg ?: amqp.Options.AssertExchange): Promise<void> {
    await MessageQueue.channel.assertExchange(
      this.exchangeName,
      exchangeType || this.exchangeType,
      exchangeCfg || this.exchangeCfg
    );
  }

  protected mergeOptions<T extends messageQueue>(this: T) {
    merge(this.exchangeCfg, this.baseExchangeCfg);
    merge(this.queueCfg, this.baseQueueCfg);
    merge(this.pubCfg, this.basePubCfg);
    merge(this.subCfg, this.baseSubCfg);
  }

  protected async initQueue<T extends messageQueue>(this: T) {
    const channel = MessageQueue.channel;
    await channel.assertQueue(this.queueName, this.queueCfg);
    await channel.bindQueue(
      this.queueName,
      this.exchangeName,
      this.routingKey !== undefined ? this.routingKey : ""
    );
  }

  static async close(): Promise<void> {
    await this.connection.close();
    await this.channel.close();
  }

  abstract put(message: unknown): Promise<void>;

  abstract registerGetter(): Promise<void>;

  static getChannel() {
    return this.channel;
  }
}

@addToMQSchemas
class URLMessageQueue extends getMQSchema({
  exchangeName: "URLExchange",
  schemaName: "URLMessageQueue",
  routingKey: "URL",
}) {
  async put(url: string): Promise<void> {
    await this.publish(url);
  }

  async registerGetter(): Promise<void> {
    await this.registerGetterAndEmitEvent(EventNames.newURL);
  }
}

@addToMQSchemas
class TimerMessageQueue extends getMQSchema({
  exchangeName: "TimerExchange",
  schemaName: "TimerMessageQueue",
}) {
  crontab!: (channel: amqp.Channel, msg: amqp.ConsumeMessage) => void;

  static async init(): Promise<never> {
    throw new Error("should use initTimer method");
  }

  static async putTimingMessage (timerMessage: TimerMessage, queue: TimerMessageQueue){
      const notLocked = await global.resourceManager.redis.connection.setnx(
        queue.queueName,
        1
      );
      if (notLocked) {
        await queue.publish(JSON.stringify(timerMessage));
      }
    };


  static async initTimer<T extends typeof TimerMessageQueue>(
    taskName: string,
    queueCfg: { messageTtl: number } & Omit<
      amqp.Options.AssertQueue,
      "deadLetterExchange"
    >,
    crontab: (channel: amqp.Channel, msg: amqp.ConsumeMessage) => void,
    immediately = false
  ): Promise<T["prototype"]> {
    const deadLetterExchange = `${taskName}_DLEX`;
    const newQueueCfg: amqp.Options.AssertQueue = {
      ...queueCfg,
      deadLetterExchange,
    };
    // use task name as routingKey
    const queueName = `${taskName}_MQ`;
    const routingKey = taskName;
    const instance: InstanceType<
      typeof TimerMessageQueue
    > = await Object.getPrototypeOf(TimerMessageQueue).init(
      queueName,
      newQueueCfg,
      routingKey
    );
    const proto = Object.getPrototypeOf(instance);
    proto.crontab = crontab;

    const timerDLMQName = `${taskName}_DLMQ_${global.resourceManager.uuid}`;

    const TimerDLMQClass = class TimerDLMQ extends getMQSchema({
      exchangeName: deadLetterExchange,
      schemaName: "TimerDLMQ",
      exchangeType: "fanout",
    }) {

      async put(timerMessage: TimerMessage) {
        await TimerMessageQueue.putTimingMessage(timerMessage, this as any)
      }

      async registerGetter(): Promise<void> {
        const channel = MessageQueue.channel;
        await channel.consume(
          timerDLMQName,
          async (msg) => {
            if (msg) {
              await global.resourceManager.redis.connection.del(
                queueName
              );
              crontab(channel, msg);
              instance.put({
                sentTime: Date().toString(),
                ttl: queueCfg.messageTtl,
              });
            } else {
              console.warn("consumer was cancelled");
            }
          },
          this.subCfg
        );
      }
    };
    addToMQSchemas(TimerDLMQClass);

    const timerDLMQ = await TimerDLMQClass.init(
      timerDLMQName
    );
    await timerDLMQ.registerGetter();

    if (immediately){
       await timerDLMQ.put({
         sentTime: Date().toString(),
         ttl: queueCfg.messageTtl,
       }); 
    }else{
       await instance.put({
         sentTime: Date().toString(),
         ttl: queueCfg.messageTtl,
       });
    }  
    return instance;
  }

  async put(timerMessage: TimerMessage) {
   await TimerMessageQueue.putTimingMessage(timerMessage, this);
  }
}

@addToMQSchemas
class HeartBeatMessageQueue extends getMQSchema({
  exchangeName: "HeartBeatExchange",
  routingKey: "HeartBeat",
  schemaName: "HeartBeatMessageQueue",
}) {
  async put(heartBeatMessage: HeartBeatMessage): Promise<void> {
    await this.publish(JSON.stringify(heartBeatMessage));
  }

  async registerGetter(): Promise<void> {}
}

@addToMQSchemas
class MockTaskMQ extends getMQSchema({
  exchangeName: "MockTaskEX",
  routingKey: "MockTask",
  schemaName: "MockTaskMQ",
}) {
  async registerGetter(getterCfg?: { precount: number }): Promise<void> {
    const channel = MessageQueue.channel;
    if (getterCfg?.precount) {
      channel.prefetch(getterCfg?.precount);
    }
    await channel.consume(
      this.queueName,
      async (msg) => {
        const taskName = "mock";
        const previousTask = taskManager.getTask(taskName);
        taskManager.updateTask(taskName, {
          taskQueue: this.queueName,
          taskQueueCfg: this.queueCfg,
          unackedNumber: previousTask ? previousTask.unackedNumber + 1 : 1,
          processingSpeed: previousTask ? previousTask.processingSpeed : 0,
        });
        if (msg) {
          global.resourceManager.eventCenter.emit(
            EventNames.newMockTask,
            channel,
            msg
          );
        } else {
          console.warn("consumer was cancelled");
        }
      },
      this.subCfg
    );
  }
}

@addToMQSchemas
class MockStateMQ extends getMQSchema({
  exchangeName: "MockStateEX",
  routingKey: "MockState",
  schemaName: "MockStateMQ",
}) {
  async put(mockStateMessage: MockStateMessage) {
    await this.publish(JSON.stringify(mockStateMessage));
  }
  async registerGetter(): Promise<void> {}
}

@addToMQSchemas
class LoadBalancingMQ extends getMQSchema({
  exchangeName: "LoadBalancingEX",
  routingKey: "LoadBalancing",
  schemaName: "LoadBalancingMQ",
}) {
  async registerGetter(): Promise<void> {}
}

export {
  URLMessageQueue,
  HeartBeatMessageQueue,
  TimerMessageQueue,
  MockTaskMQ,
  MockStateMQ,
  LoadBalancingMQ,
  MessageQueue,
};
