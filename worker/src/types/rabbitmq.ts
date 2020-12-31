import {Task} from './task'
import amqp from "amqplib";

enum NodeType {
    master,
    worker 
}

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
  | "MockTaskMQ"
  | "MockStateMQ";

  
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
  schemaName: MQSchemaTypes;
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
  formattedDate: string;
  uuid: string;
  ip: string;
  cpuFree: number;
  cpuUsage: number;
  totalmem: number;
  freemem: number;
  task: Record<string, Task>;

  constructor(
    nodeType = NodeType.worker,
    timestamp: number,
    formattedDate: string,
    uuid: string,
    ip: string,
    cpuFree: number,
    cpuUsage: number,
    totalmem: number,
    freemem: number,
    task: Record<string, Task>
  ) {
    this.nodeType = nodeType;
    this.timestamp = timestamp;
    this.formattedDate = formattedDate;
    this.uuid = uuid;
    this.ip = ip;
    this.totalmem = totalmem;
    this.freemem = freemem;
    (this.cpuFree = cpuFree), (this.cpuUsage = cpuUsage);
    this.task = task;
  }
}

interface TimerMessage {
  sentTime: string;
  ttl: number;
}

interface MockTaskMessage {
  processingTime: number;
}

interface MockStateMessage {
    uuid: string
    processedTasksNumber: number
    totalProcessingTime: number
}

interface LoadBalancingMessage {
  priority?: number;
  prefecthedCount?: number;
}

export { exchangeType, messageQueue, HeartBeatMessage, NodeType, MQSchemaTypes, messageQueueCfg, TimerMessage, MockTaskMessage, MockStateMessage, LoadBalancingMessage };
