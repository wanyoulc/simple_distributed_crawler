import {LoadBalancingMessage} from "../types/rabbitmq"
import { NodeTable } from "../types/node";
import util from 'util'

export function getLoadBalancingWeight(nodeTable: NodeTable, messageNumbers: Record<string, number>) {
    /**
     * {
     *  node1: {
     *      task: {
     *              task1: {
     *                        }
     *            }
     * }
     * }
     */
     const allTasksSpeedSum = Object.values(nodeTable).reduce((acc, cur) => {
       Object.keys(cur.task).forEach(k => {
         acc[k] = acc[k]
           ? cur.task[k].processingSpeed + acc[k]
           : cur.task[k].processingSpeed;
       })
       return acc
     }, {} as Record<string,number>)

     const loadBalancingWeight = Object.values(nodeTable).reduce((weights, node) => {
       weights[node.uuid] = {
         task: Object.keys(node.task).reduce((weight, taskName) => {
          // console.log("node task",
          //   util.inspect(node.task, {
          //     showHidden: false,
          //     depth: null,
          //   })
          // ); 
          // console.log(
          //   "allTasksSpeedSum",
          //   util.inspect(allTasksSpeedSum, {
          //     showHidden: false,
          //     depth: null,
          //   })
          // ); 
          // console.log(
          //   "messageNumbers",
          //   util.inspect(messageNumbers, {
          //     showHidden: false,
          //     depth: null,
          //   })
          // ); 
          
           weight[taskName] = {
             prefecthedCount:
               (node.task[taskName].processingSpeed /
                 allTasksSpeedSum[taskName] * messageNumbers[taskName]),
           };
           return weight 
         }, {} as Record<string, LoadBalancingMessage>)
       }
       return weights
     } , {} as Record<string, {task: Record<string, LoadBalancingMessage>}>)

     return loadBalancingWeight
}

// export function deletedQueue<T extends { new (...args: any[]): {} }>(
//   constructor: T
// ) {
//   const deletedQueue = Symbol()
//   Object.defineProperty(constructor, deletedQueue, {
//     enumerable: false,
//     configurable: false,
//     value: true
//   })
// }

export function bytesToGB(bytes: number) {
  return bytes / (1024 * 1024 * 1024);
}

export function getFormattedDate() {
  var date = new Date();
  var str =
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



export function exitHandler(handler: Function) {
  async function _exitHandler(evtOrExitCodeOrError: number | string | Error) {
    try {
      // await async code here
      // Optionally: Handle evtOrExitCodeOrError here
      await handler()
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