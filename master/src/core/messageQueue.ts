import {
  HeartBeatMessage,
  LoadBalancingMessage,
  MQSchemaTypes,
  TimerMessage,
  exchangeType,
  messageQueue,
  messageQueueCfg
} from "../types/rabbitmq";

import { MQParamException } from "../exceptions/exception";
import amqp from "amqplib";
import config from "../config/index";
import { merge } from "lodash";
import { node } from "../types/node";

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
      await instance.initQueue()
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
    // await this.initQueue();
    MessageQueue.channel.publish(
      this.exchangeName,
      this.routingKey,
      Buffer.from(url),
      this.pubCfg
    );
  }

  async registerGetter(): Promise<void> {
    const channel = MessageQueue.channel;
    // await this.initQueue();
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
class TimerMessageQueue extends getMQSchema({
  exchangeName: "TimerExchange",
  schemaName: "TimerMessageQueue",
  routingKey: "Timer",
}) {
  crontab!: Function;

  constructor(
    queueName: string,
    queueCfg: { messageTtl: number } & 
      amqp.Options.AssertQueue
  ) {
    super(queueName, queueCfg);
  }

  static async init(): Promise<never>{
    throw new Error('should use initTimer method')
  }

  static async initTimer<T extends typeof MessageQueue>(
    queueName: string,
    queueCfg: { messageTtl: number } & Omit<
      amqp.Options.AssertQueue,
      "deadLetterExchange"
    >,
    crontab : Function
  ): Promise<T['prototype']> {
    const deadLetterExchange = `${queueName}_DLEX`
     const newQueueCfg: amqp.Options.AssertQueue = {
       ...queueCfg,
       deadLetterExchange,
     };
    const instance: InstanceType<typeof TimerMessageQueue> = await Object.getPrototypeOf(TimerMessageQueue).init(queueName, newQueueCfg)
    const proto = Object.getPrototypeOf(instance)
    proto.crontab = crontab

    const TimerDLMQClass = class TimerDLMQ extends getMQSchema({
      exchangeName: deadLetterExchange,
      schemaName: "TimerDLMQ",
      exchangeType: "fanout"
    }) {
      constructor(
        queueName: string,
        queueCfg?: amqp.Options.AssertQueue,
        routingKey?: string
      ) {
        super(queueName, queueCfg, routingKey);
      }

      async registerGetter(): Promise<void> {
        const channel = MessageQueue.channel;
        await this.initQueue();
        await channel.consume(
          this.queueName,
          (msg) => {
            if (msg) {
              crontab(msg)
              instance.put({
                sentTime: Date().toString(),
                ttl: queueCfg.messageTtl
              })
            } else {
              console.warn("consumer was cancelled");
            }
          },
          this.subCfg
        );
      }
    };
    addToMQSchemas(TimerDLMQClass)

    const timerDLMQ = await TimerDLMQClass.init(`${queueName}_DLMQ`)
    await timerDLMQ.registerGetter()

    await instance.put({
      sentTime: Date().toString(),
      ttl: queueCfg.messageTtl,
    });
    return instance
  }

  async put<T>(timerMessage: T & TimerMessage) {
    await this.initQueue();
    MessageQueue.channel.publish(
      this.exchangeName,
      this.routingKey,
      Buffer.from(JSON.stringify(timerMessage)),
      this.pubCfg
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

  async registerGetter(): Promise<void> {
    const channel = MessageQueue.channel;
    await this.initQueue();
    await channel.consume(
      this.queueName,
      (heartBeatMsg) => {
        if (heartBeatMsg) {
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
          };
          global.resourceManager.nodeTable[uuid] = nodeProps;
          channel.ack(heartBeatMsg);
        } else {
          console.warn("consumer was cancelled");
        }
      },
      this.subCfg
    );
  }
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



// @addToMQSchemas
// class LoadBalancingMQ extends getMQSchema({
//   exchangeName: "LoadBalancingEX",
//   queueCfg: {
//     deadLetterExchange: "LoadBalancingDLEX",
//     messageTtl: 2000,
//   },
//   routingKey: "LoadBalancing",
//   schemaName: "LoadBalancingMQ",
// }) {
//   constructor(
//     queueName: string,
//     queueCfg?: amqp.Options.AssertQueue,
//     routingKey?: string
//   ) {
//     super(queueName, queueCfg, routingKey);
//   }

//   async put<T>(loadBalancingMessage: T & Record<string, LoadBalancingMessage>): Promise<void> {
//     await this.initQueue();
//     MessageQueue.channel.publish(
//       this.exchangeName,
//       this.routingKey,
//       Buffer.from(JSON.stringify(loadBalancingMessage)),
//       this.pubCfg
//     );
//   }
// }

// @addToMQSchemas
// class LoadBalancingDLMQ extends getMQSchema({
//   exchangeName: "LoadBalancingDLEX",
//   exchangeType: "fanout",
//   schemaName: "LoadBalancingDLMQ",
// }) {
//   constructor(
//     queueName: string,
//     queueCfg?: amqp.Options.AssertQueue,
//     routingKey?: string
//   ) {
//     super(queueName, queueCfg, routingKey);
//   }

//   async put<T>(
//     loadBalancingMessage: T & Record<string, LoadBalancingMessage>
//   ): Promise<void> {}

//   async registerGetter(): Promise<void> {
//     const channel = MessageQueue.channel;
//     await this.initQueue();
//     await channel.consume(
//       this.queueName,
//       (msg) => {
//         if (msg) {
//           global.resourceManager.eventCenter.emit("newLoadBalancingConfig", channel, msg);
//         } else {
//           console.warn("consumer was cancelled");
//         }
//       },
//       this.subCfg
//     );
//   }
// }




export { URLMessageQueue, HeartBeatMessageQueue, HeartBeatDLMQ, TimerMessageQueue };
