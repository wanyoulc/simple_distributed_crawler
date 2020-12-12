import { MongoConnectionManager, RedisConnectionManager } from "../core/db";
import { URLMessageQueue, HeartBeatMessageQueue } from "../core/messageQueue";
import EventEmitter from "events";
import {NodeTable} from "./node"

declare global {
    namespace NodeJS {
        interface Global {
            resourceManager: {
                mongo: MongoConnectionManager;
                urlMQ: URLMessageQueue;
                workerHBMQ: HeartBeatMessageQueue;
                redis: RedisConnectionManager;
                eventCenter: EventEmitter.EventEmitter;
                uuid: string;
                ip: string;
                nodeTable: NodeTable
            };
        }
    }
}

export default global;
