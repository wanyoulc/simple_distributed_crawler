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
    freemem: number
}

interface nodeTable {
    [index: string]: node
}

export {NodeType, node, nodeTable}