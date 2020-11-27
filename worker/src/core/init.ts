import {Channel, ConsumeMessage} from 'amqplib'
import { HeartBeatDLMQ, HeartBeatMessageQueue, URLMessageQueue } from "./messageQueue";
import {HeartBeatMessage, NodeType} from "../types/rabbitmq"
import { MongoConnectionManager, RedisConnectionManager } from "./db";
import {bytesToGB, getFormattedDate} from '../lib/utils'
import {cpuFree, cpuUsage} from 'os-utils'
import { freemem, totalmem } from "os";

import EventEmitter from "events";
import address from "address"
import logHandler from "../exceptions/logHandler"
import logLevel from "../types/log"
import tasksChain from "./tasksCahin";
import { v4 as uuidv4 } from 'uuid';

class InitManager {
    static mongo: MongoConnectionManager;
    static urlMQ: URLMessageQueue;
    static workerHBMQ: HeartBeatMessageQueue;
    static heartBeatDLMQ: HeartBeatDLMQ
    static redis: RedisConnectionManager;
    static eventCenter: EventEmitter.EventEmitter;
    static uuid: string
    static ip: string
    static cpuUsage: number
    static cpuFree: number


    private constructor() {}

    static async init() {
        global.resourceManager = InitManager;
        this.ip = address.ip()
        this.uuid = uuidv4()
        this.storeCPUMessage()
        this.initEventCenter();
        await Promise.all([this.initDB(), this.initMQ(), this.initRedis()]);
        this.urlMQ.registerGetter()
        this.heartBeatDLMQ.registerGetter()
        
    }

    static storeCPUMessage() {
        setInterval(() => {
            cpuFree((percentage: number) => {
              this.cpuFree = percentage;
            });
            cpuUsage((percentage: number) => {
              this.cpuUsage = percentage;
            });
        }, 100)
    }

    static async initDB() {
        this.mongo = await MongoConnectionManager.init();
    }

    static async initRedis() {
        this.redis = await RedisConnectionManager.init();
    }

    static async initMQ() {
        this.urlMQ = await URLMessageQueue.init("URL");
        this.workerHBMQ = await HeartBeatMessageQueue.init("workerHBMQ", {}, "workerHBMQ")
        this.heartBeatDLMQ = await HeartBeatDLMQ.init("HBDLMQ"+this.uuid)
    }

    static initEventCenter() {
        class EventCenter extends EventEmitter.EventEmitter {}
        const eventCenter = new EventCenter();
        this.eventCenter = eventCenter;
        this.eventCenter.on("newUrl", async function(url, channel:Channel, urlMsg: ConsumeMessage) {
            await tasksChain(url);
            channel.ack(urlMsg)
        });
        this.eventCenter.on("newHeartBeat", async (channel: Channel, msg: ConsumeMessage) => {
            const heartBeat = new HeartBeatMessage(
              NodeType.worker,
              new Date().getTime(),
              getFormattedDate(),
              this.uuid,
              this.ip,
              this.cpuFree,
              this.cpuUsage,
              bytesToGB(totalmem()),
              bytesToGB(freemem())
            );
            await this.workerHBMQ.put(heartBeat)
            channel.ack(msg)
        })
        this.eventCenter.on('log',function(level: logLevel, message: string, err ?:Error){
            logHandler(level, message, err)
        } )
        process.on('uncaughtException', function(err) {
            console.error("uncaughtException!")
            logHandler('ERROR', err.message,err)
        })
        // process.on('unhandledRejection', function(reason){
        //     console.error('unhandledRejection!')
        //     logHandler('ERROR',  reason!.toString())
        // })
    }
}

export default InitManager;
