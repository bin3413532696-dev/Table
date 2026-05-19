"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTaskList = getTaskList;
exports.createTaskRecord = createTaskRecord;
exports.getTaskDetail = getTaskDetail;
exports.updateTaskRecord = updateTaskRecord;
exports.deleteTaskRecord = deleteTaskRecord;
const repository_1 = require("./repository");
const dto_1 = require("./dto");
const conflict_1 = require("../../shared/conflict");
async function getTaskList() {
    const tasks = await (0, repository_1.listTasks)();
    return tasks.map(dto_1.toTaskDto);
}
async function createTaskRecord(input) {
    const task = await (0, repository_1.createTask)(input);
    return (0, dto_1.toTaskDto)(task);
}
async function getTaskDetail(id) {
    const task = await (0, repository_1.findTaskById)(id);
    return task ? (0, dto_1.toTaskDto)(task) : null;
}
async function updateTaskRecord(id, input) {
    const existing = await (0, repository_1.findTaskById)(id);
    const task = await (0, repository_1.updateTask)(id, input);
    const ensured = (0, conflict_1.ensureMutationResult)(existing, task, 'Task was modified by another request. Please refresh and try again.');
    return ensured ? (0, dto_1.toTaskDto)(ensured) : null;
}
async function deleteTaskRecord(id) {
    const existing = await (0, repository_1.findTaskById)(id);
    if (!existing) {
        return null;
    }
    const task = await (0, repository_1.softDeleteTask)(id);
    return (0, dto_1.toTaskDto)(task);
}
