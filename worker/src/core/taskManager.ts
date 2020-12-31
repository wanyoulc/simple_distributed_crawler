import {Task} from '../types/task'
import {singleton} from '../lib/utils'

@singleton
class TaskManager {
    private tasks: Record<string, Task>
    constructor() {
        this.tasks = {}
    }
    updateTask(name: string, task: Task) {
        this.tasks[name] = task
    }
    getTask(name: string) {
        return this.tasks[name]
    }
    getTasks() {
        return this.tasks
    }
}


export default new TaskManager()