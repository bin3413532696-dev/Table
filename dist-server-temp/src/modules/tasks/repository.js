"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTasks = listTasks;
exports.createTask = createTask;
exports.findTaskById = findTaskById;
exports.updateTask = updateTask;
exports.softDeleteTask = softDeleteTask;
const client_1 = require("../../db/client");
const user_context_1 = require("../../shared/user-context");
async function listTasks() {
    return client_1.prisma.task.findMany({
        where: {
            userId: (0, user_context_1.getCurrentUserId)(),
            deletedAt: null,
        },
        orderBy: {
            updatedAt: 'desc',
        },
    });
}
async function createTask(input) {
    return client_1.prisma.task.create({
        data: {
            userId: (0, user_context_1.getCurrentUserId)(),
            title: input.title,
            completed: input.completed ?? false,
            priority: input.priority,
            dueDate: input.dueDate ? new Date(input.dueDate) : null,
            notes: input.notes,
        },
    });
}
async function findTaskById(id) {
    return client_1.prisma.task.findFirst({
        where: {
            id,
            userId: (0, user_context_1.getCurrentUserId)(),
            deletedAt: null,
        },
    });
}
async function updateTask(id, input) {
    return client_1.prisma.task.updateManyAndReturn({
        where: {
            id,
            userId: (0, user_context_1.getCurrentUserId)(),
            deletedAt: null,
            version: input.version,
        },
        data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(input.completed !== undefined ? { completed: input.completed } : {}),
            ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
            ...(input.dueDate !== undefined
                ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
                : {}),
            version: {
                increment: 1,
            },
        },
    }).then((tasks) => tasks[0] ?? null);
}
async function softDeleteTask(id) {
    return client_1.prisma.task.update({
        where: { id, userId: (0, user_context_1.getCurrentUserId)() },
        data: {
            deletedAt: new Date(),
            version: {
                increment: 1,
            },
        },
    });
}
