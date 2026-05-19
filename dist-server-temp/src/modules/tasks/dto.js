"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toTaskDto = toTaskDto;
const date_1 = require("../../shared/date");
function toTaskDto(task) {
    return {
        id: task.id,
        title: task.title,
        completed: task.completed,
        priority: task.priority,
        dueDate: (0, date_1.toDateOnly)(task.dueDate),
        notes: task.notes ?? undefined,
        createdAt: (0, date_1.toTimestamp)(task.createdAt),
        updatedAt: (0, date_1.toTimestamp)(task.updatedAt),
        version: task.version,
    };
}
