import {
  HeartBeatMessage,
  MQSchemaTypes,
  exchangeType,
  messageQueue,
  messageQueueCfg,
} from "../types/rabbitmq";

import { MQParamException } from "../exceptions/exception";
import amqp from "amqplib";
import config from "../config/index";
import { merge } from "lodash";

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
    subCfg: amqp.Options.Consume = config.subCfg || {
      noAck: false,
    };
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
      routingKey?: string
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
      await instance.initExchange();
      return instance;
    }

    async put<T>(message: T): Promise<void> {}
    async registerGetter(): Promise<void> {}
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

  protected async initExchange<T extends messageQueue>(this: T): Promise<void> {
    await MessageQueue.channel.assertExchange(
      this.exchangeName,
      this.exchangeType,
      this.exchangeCfg
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

  abstract async put<T>(message: T): Promise<void>;

  abstract async registerGetter(): Promise<void>;
}

@addToMQSchemas
class URLMessageQueue extends getMQSchema({
  exchangeName: "URLExchange",
  schemaName: "URLMessageQueue",
  routingKey: "URL",
}) {
  constructor(
    queueName: string,
    queueCfg?: amqp.Options.AssertQueue,
    routingKey?: string
  ) {
    super(queueName, queueCfg, routingKey);
  }
  async put<T>(url: T): Promise<void> {
    if (typeof url !== "string") {
      return Promise.reject({
        logLevel: "ERROR",
        message: `URL为${url},不是string类型`,
        error: new MQParamException("url必须为string类型"),
      });
    }
    await this.initQueue();
    MessageQueue.channel.publish(
      this.exchangeName,
      this.routingKey,
      Buffer.from(url),
      this.pubCfg
    );
  }

  async registerGetter(): Promise<void> {
    const channel = MessageQueue.channel;
    await this.initQueue();
    await channel.consume(
      this.queueName,
      (urlMsg) => {
        if (urlMsg) {
          global.resourceManager.eventCenter.emit(
            "newUrl",
            urlMsg.content.toString(),
            channel,
            urlMsg
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
class HeartBeatMessageQueue extends getMQSchema({
  exchangeName: "HeartBeatExchange",
  queueCfg: {
    deadLetterExchange: "HeartBeatDLEX",
    messageTtl: 2000,
  },
  routingKey: "HeartBeat",
  schemaName: "HeartBeatMessageQueue",
}) {
  constructor(
    queueName: string,
    queueCfg?: amqp.Options.AssertQueue,
    routingKey?: string
  ) {
    super(queueName, queueCfg, routingKey);
  }

  async put<T>(heartBeatMessage: T & HeartBeatMessage): Promise<void> {
    await this.initQueue();
    MessageQueue.channel.publish(
      this.exchangeName,
      this.routingKey,
      Buffer.from(JSON.stringify(heartBeatMessage)),
      this.pubCfg
    );
  }

  async registerGetter(): Promise<void> {}
}

@addToMQSchemas
class HeartBeatDLMQ extends getMQSchema({
  exchangeName: "HeartBeatDLEX",
  exchangeType: "fanout",
  schemaName: "HeartBeatDLMQ",
}) {
  constructor(
    queueName: string,
    queueCfg?: amqp.Options.AssertQueue,
    routingKey?: string
  ) {
    super(queueName, queueCfg, routingKey);
  }

  async put<T>(heartBeatMessage: T & HeartBeatMessage): Promise<void> {}

  async registerGetter(): Promise<void> {
    const channel = MessageQueue.channel;
    await this.initQueue();
    await channel.consume(
      this.queueName,
      (msg) => {
        if (msg) {
          global.resourceManager.eventCenter.emit("newHeartBeat", channel, msg);
        } else {
          console.warn("consumer was cancelled");
        }
      },
      this.subCfg
    );
  }
}

export { URLMessageQueue, HeartBeatMessageQueue, HeartBeatDLMQ };
