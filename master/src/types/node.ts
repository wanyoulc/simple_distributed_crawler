import {Task} from './task'

enum NodeType {
    master,
    worker 
}


interface node {
    nodeType: NodeType
    uuid: string;
    ip: string;
    lastActived: number,
    formattedLastActived: string,
    cpuUsage: number,
    cpuFree: number,
    totalmem: number,
    freemem: number,
    task: Record<string, Task>
}

interface NodeTable {
    [index: string]: node
}

export {NodeType, node, NodeTable}