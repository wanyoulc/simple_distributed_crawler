import {NodeType} from "./node"
import amqp from "amqplib";

enum MessageSignal {
    kill
}

type exchangeType = "direct" | "fanout" | "topic";


type MQSchemaTypes =
  | "URLMessageQueue"
  | "HeartBeatMessageQueue"
  | "HeartBeatDLMQ"
  | "LoadBalancingMQ"
  | "LoadBalancingDLMQ"
  | "TimerMessageQueue"
  | "TimerDLMQ"

interface messageQueue {
    baseExchangeCfg: amqp.Options.AssertExchange;
    baseQueueCfg: amqp.Options.AssertQueue;
    basePubCfg: amqp.Options.Publish;
    baseSubCfg: amqp.Options.Consume;
    exchangeName: string;
    exchangeType: exchangeType;
    exchangeCfg: amqp.Options.AssertExchange;
    queueCfg: amqp.Options.AssertQueue;
    pubCfg: amqp.Options.Publish;
    subCfg: amqp.Options.Consume;
    queueName: string;
    routingKey?: string;
}

interface messageQueueCfg {
  schemaName:  MQSchemaTypes
  exchangeName: string;
  exchangeType?: exchangeType;
  exchangeCfg?: amqp.Options.AssertExchange;
  queueCfg?: amqp.Options.AssertQueue;
  pubCfg?: amqp.Options.Publish;
  subCfg?: amqp.Options.Consume;
  queueName?: string;
  routingKey?: string;
}


class HeartBeatMessage {
    nodeType: NodeType;
    timestamp: number;
    uuid: string
    ip : string
    signal ?: MessageSignal

    constructor(nodeType = NodeType.worker, timestamp:number, uuid: string, ip:string){
        this.nodeType = nodeType;
        this.timestamp = timestamp;
        this.uuid = uuid
        this.ip = ip
    }
}

interface LoadBalancingMessage {
  priority: number,
  prefecthedCount: number
}

interface TimerMessage {
  sentTime: string
  ttl: number
}

export { exchangeType, messageQueue, HeartBeatMessage, messageQueueCfg, MQSchemaTypes, LoadBalancingMessage, TimerMessage };
