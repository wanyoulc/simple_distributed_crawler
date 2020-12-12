import logLevel from "../types/log";
import util from 'util'

export default function logHandler(level: logLevel, message: string | object, err?: Error) {
    if (process.env.NODE_ENV === "dev") {
        if (typeof message === "object" && message !== null){
            console.log(
              util.inspect(message, {
                showHidden: false,
                depth: null,
              })
            );
            return
        }
          switch (level) {
            case "ERROR":
              console.error(message);
              break;
            case "WARN":
              console.warn(message);
              break;
            case "INFO":
              console.info(message);
              break;
            case "DEBUG":
              console.debug(message);
          }
    } else {
        // 写入日志文件
    }
}
