export function bytesToGB(bytes: number) {
    return bytes/(1024*1024*1024)
}

export function getFormattedDate() {
  const date = new Date();
  const str =
    date.getFullYear() +
    "-" +
    (date.getMonth() + 1) +
    "-" +
    date.getDate() +
    " " +
    date.getHours() +
    ":" +
    date.getMinutes() +
    ":" +
    date.getSeconds();

  return str;
}

export function sleep(time: number) {
    const start = new Date().getTime()
    while(new Date().getTime() - start < time) {
      
    }
}

export function assumeType<T>(x: unknown): asserts x is T {
  return;
}

export function singleton<T extends { new (...args: any[]): {} }>(
  constructor: T
) {
  return class Singleton extends constructor {
    static single: symbol = Symbol("single");
    constructor(...args: any[]) {
      const instance = Reflect.getOwnPropertyDescriptor(
        Singleton,
        Singleton.single
      )?.value;
      if (!instance) {
        super(...args);
        Reflect.defineProperty(Singleton, Singleton.single, {
          value: this,
        });
        return this;
      }
      return instance;
    }
  };
}

export function exitHandler(handler: Function) {
  async function _exitHandler(evtOrExitCodeOrError: number | string | Error) {
    try {
      // await async code here
      // Optionally: Handle evtOrExitCodeOrError here
      await handler();
    } catch (e) {
      console.error("EXIT HANDLER ERROR", e);
    }

    process.exit(isNaN(+evtOrExitCodeOrError) ? 1 : +evtOrExitCodeOrError);
  }

  [
    "beforeExit",
    "uncaughtException",
    "unhandledRejection",
    "SIGHUP",
    "SIGINT",
    "SIGQUIT",
    "SIGILL",
    "SIGTRAP",
    "SIGABRT",
    "SIGBUS",
    "SIGFPE",
    "SIGUSR1",
    "SIGSEGV",
    "SIGUSR2",
    "SIGTERM",
  ].forEach((evt) => process.on(evt as any, _exitHandler));
}