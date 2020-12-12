import InitManager from "./core/init";
import Koa from "koa";
import {LoadBalancingStrategy} from "./types/task"
import bodyParser from "koa-bodyparser"
import commandLineArgs from "command-line-args";
import exceptionHandler from "./middleware/exceptionEmitter"
import {ask} from 'stdio'

async function main() {
    process.env.NODE_ENV = 'dev'
    const mainDefinitions: commandLineArgs.OptionDefinition[] = [
      { name: "mock", type: Boolean, alias: "m" },
      {name: "port", type: Number, alias: "p"}
    ];
    const mainOptions = commandLineArgs(mainDefinitions, {
      stopAtFirstUnknown: true,
    });
    const argv = mainOptions._unknown || [];
    let mockOptions: commandLineArgs.CommandLineOptions | undefined;
    if (mainOptions.mock) {
      const mockDefinitions: commandLineArgs.OptionDefinition[] = [
        {
          name: "taskNumber",
          type: Number,
          alias: "t",
          defaultValue: 1000,
        },
        {
          name: "async",
          type: Boolean,
          defaultValue: false,
        },
        {
          name: "strategy",
          type: String,
          defaultValue: LoadBalancingStrategy.ROUND_ROBIN
        },
      ];
      mockOptions = commandLineArgs(mockDefinitions, { argv });
    }
    try {
        await InitManager.init();
        if (mockOptions){
              await InitManager.redis.connection.set(
                "load_balancing_strategy",
                  mockOptions.strategy
              );
             const answer = await ask("start test now ?", {
               options: ['y', 'n']
             }) 
             if (answer === 'y'){
               await InitManager.initMock(mockOptions);
             }else{
               process.exit()
             }
        }
    }catch(e) {
        global.resourceManager.eventCenter.emit('log','ERROR','init error',e )
    }
    const port = mainOptions.port || 3000
    if (port < 3000 || port > 65535){
        throw new Error('invalid port')
    }
    const app = new Koa();
    app.use(exceptionHandler)
    app.use(bodyParser())
    for (const router of InitManager.routers){
        app.use(router.routes()).use(router.allowedMethods())
    }
    app.listen(port, () => {
        console.log(`server is listening at port ${port}`)
    });

}
main()