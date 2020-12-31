import {exitHandler} from '../lib/utils'
import {MessageQueue} from '../core/messageQueue'
import InitManager from '../core/init'
import axios from 'axios'
import config from "../config";
import Redis from 'ioredis'

exitHandler(async () => {
    const allQueues = (await axios.get("http://localhost:15672/api/queues", {
          auth: {
            username: "guest",
            password: "guest",
          },
        })).data;
    for (let queue of allQueues) {
        const name: string = queue.name
        if (name.match(/^workerHBTimer_DLMQ_[a-zA-Z0-9\-]+$/)){
            await axios.delete(`http://localhost:15672/api/queues/%2F/${name}`, {
                auth: {
                    username: 'guest',
                    password: 'guest'
                }
            });
        }
    }
     const redis = new Redis(config.redisConfig);
     await redis.connect();
     await redis.del('workerHBTimer_MQ')
})

process.stdin.resume();