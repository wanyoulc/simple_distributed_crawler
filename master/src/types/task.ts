import amqp from 'amqplib'

export enum LoadBalancingStrategy {
  ROUND_ROBIN = "ROUND_ROBIN",
  RB = "RB",
  PROCESSING_SPEED_FIRST = "PROCESSING_SPEED_FIRST",
  PSF = "PSF",
  CURREENT_PROCESSING_NUM = "CURREENT_PROCESSING_NUM",
  CPN = "CPN"
}

export interface Task {
  taskQueue: string;
  taskQueueCfg: amqp.Options.Consume;
  unackedNumber: number;
  processingSpeed: number;
}

