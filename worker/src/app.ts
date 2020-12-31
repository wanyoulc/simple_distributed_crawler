import InitManager from "./core/init";
import commandLineArgs from 'command-line-args'

async function main() {
    const mainDefinitions: commandLineArgs.OptionDefinition[] = [
        {name: "mock", type: Boolean, alias: 'm'}
    ]
    const mainOptions = commandLineArgs(mainDefinitions, {
      stopAtFirstUnknown: true,
    });
    const argv = mainOptions._unknown || [];
    let mockOptions: commandLineArgs.CommandLineOptions | undefined
    if (mainOptions.mock) {
        const mockDefinitions: commandLineArgs.OptionDefinition[] = [{
            name: "factor",
            type: Number,
            alias: "f",
            defaultValue: 1
        }
    ];
        mockOptions = commandLineArgs(mockDefinitions, { argv });
    }
    try {
        await InitManager.init();
        if (mockOptions) {
            await InitManager.initMock(mockOptions)
        }
    } catch (e) {
        global.resourceManager.eventCenter.emit("log", "ERROR", "init error", e);
    }
}
main();
