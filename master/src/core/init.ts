import {Channel, ConsumeMessage} from 'amqplib'
import { HeartBeatDLMQ, HeartBeatMessageQueue, TimerMessageQueue, URLMessageQueue } from "./messageQueue";
import { MongoConnectionManager, RedisConnectionManager } from "./db";
import { NodeType, nodeTable } from "../types/node";

import EventEmitter from "events";
import {HeartBeatMessage} from "../types/rabbitmq"
import Router from "koa-router";
import address from "address"
import config from "../config"
import crawlerRouter from "../api/crawler";
import logHandler from "../exceptions/logHandler"
import logLevel from "../types/log"
import {startCronJob} from "../util"
import { v4 as uuidv4 } from 'uuid';

class InitManager {
    static mongo: MongoConnectionManager;
    static urlMQ: URLMessageQueue;
    static masterHBMQ: HeartBeatMessageQueue;
    static workerHBMQ: HeartBeatMessageQueue;
    static heartBeatDLMQ: HeartBeatDLMQ
    static redis: RedisConnectionManager;
    static eventCenter: EventEmitter.EventEmitter;
    static routers: Router[];
    static uuid: string
    static ip: string
    static nodeTable: nodeTable

    private constructor() {}

    static async init() {
        global.resourceManager = InitManager;
        this.uuid = uuidv4()
        this.ip = address.ip()
        this.initNodeTable()
        this.initEventCenter();
        this.initRouter();
        await Promise.all([this.initDB(), this.initMQ(), this.initRedis()]);
        // this.urlMQ.registerGetter()
        // this.heartBeatDLMQ.registerGetter()
        // this.workerHBMQ.registerGetter()
        // const heartBeat = new HeartBeatMessage(NodeType.master, new Date().getTime(), this.uuid, this.ip)
        // this.masterHBMQ.put(heartBeat)
        startCronJob(this.updateNodeTable.bind(this), 1000)
        
    }

    static async initDB() {
        this.mongo = await MongoConnectionManager.init();
    }

    static async initRedis() {
        this.redis = await RedisConnectionManager.init();
    }

    static async initMQ() {
        // this.urlMQ = await URLMessageQueue.init("URL");
        // this.masterHBMQ = await HeartBeatMessageQueue.init("masterHBMQ", undefined, "masterHBMQ")
        // this.workerHBMQ = await HeartBeatMessageQueue.init("workerHBMQ", {}, "workerHBMQ")
        // this.heartBeatDLMQ = await HeartBeatDLMQ.init("HBDLMQ"+this.uuid)
        await TimerMessageQueue.initTimer("test", {
            messageTtl: 1000
        }, () => console.log('test'))

    }

    static initRouter() {
        this.routers = []
        this.routers.push(crawlerRouter);
    }

    static initEventCenter() {
        class EventCenter extends EventEmitter.EventEmitter {}
        const eventCenter = new EventCenter();
        this.eventCenter = eventCenter;
        // this.eventCenter.on("newUrl", function(url) {
        //     tasksChain(url);
        // });

        this.eventCenter.on("newHeartBeat", async (channel: Channel, msg: ConsumeMessage) => {
            const heartBeat = new HeartBeatMessage(NodeType.master, new Date().getTime(), this.uuid, this.ip)
            await this.masterHBMQ.put(heartBeat)
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

    static initNodeTable(){
        const nodeTable = this.nodeTable = {}
        Object.defineProperty(nodeTable, "size", {
            get: function(){
                return Object.keys(nodeTable).length
            }
        })
    }

    static updateNodeTable() {
        this.eventCenter.emit("log", "INFO", this.nodeTable)
        const curDate = new Date()
        Object.keys(this.nodeTable).forEach(uuid => {
            const interval = curDate.getTime() - this.nodeTable[uuid].lastActived
            if (interval > config.updateNodeInterval){
                this.eventCenter.emit("log", "INFO", `child node ${uuid} has deactived`)
                delete this.nodeTable[uuid]
            }
        })
    }
}

export default InitManager;
