import { MongoConnectionManager, RedisConnectionManager } from "../core/db";
import { URLMessageQueue } from "../core/messageQueue";
import EventEmitter from "events";

declare global {
    namespace NodeJS {
        interface Global {
            resourceManager: {
                mongo: MongoConnectionManager;
                urlMQ: URLMessageQueue;
                redis: RedisConnectionManager;
                eventCenter: EventEmitter.EventEmitter;
                uuid: string
            };
        }
    }
}


export default global;
