import Config from "../types/config";

const hostIP = process.env.host_ip || "192.168.2.134";

const config: Config = {
  nginxAddress: `${hostIP}:80`,
  rabbitMQAddress: `amqp://${hostIP}:5672`,
  mongoAddress: `mongodb://${hostIP}/crawler`,
  redisConfig: {
    port: 6379,
    host: hostIP,
    lazyConnect: true,
  },
};

export default config;
