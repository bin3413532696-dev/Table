"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFinanceRecords = listFinanceRecords;
exports.createFinanceRecord = createFinanceRecord;
exports.findFinanceRecordById = findFinanceRecordById;
exports.updateFinanceRecord = updateFinanceRecord;
exports.softDeleteFinanceRecord = softDeleteFinanceRecord;
const client_1 = require("../../db/client");
const user_context_1 = require("../../shared/user-context");
async function listFinanceRecords() {
    return client_1.prisma.financeRecord.findMany({
        where: {
            userId: (0, user_context_1.getCurrentUserId)(),
            deletedAt: null,
        },
        orderBy: {
            updatedAt: 'desc',
        },
    });
}
async function createFinanceRecord(input) {
    return client_1.prisma.financeRecord.create({
        data: {
            userId: (0, user_context_1.getCurrentUserId)(),
            type: input.type,
            amount: input.amount,
            category: input.category,
            description: input.description,
            recordDate: new Date(input.date ?? input.recordDate ?? ''),
            model: input.model ?? null,
        },
    });
}
async function findFinanceRecordById(id) {
    return client_1.prisma.financeRecord.findFirst({
        where: {
            id,
            userId: (0, user_context_1.getCurrentUserId)(),
            deletedAt: null,
        },
    });
}
async function updateFinanceRecord(id, input) {
    return client_1.prisma.financeRecord.updateManyAndReturn({
        where: {
            id,
            userId: (0, user_context_1.getCurrentUserId)(),
            deletedAt: null,
            version: input.version,
        },
        data: {
            ...(input.type !== undefined ? { type: input.type } : {}),
            ...(input.amount !== undefined ? { amount: input.amount } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.date !== undefined || input.recordDate !== undefined
                ? { recordDate: new Date(input.date ?? input.recordDate ?? '') }
                : {}),
            ...(input.model !== undefined ? { model: input.model ?? null } : {}),
            version: {
                increment: 1,
            },
        },
    }).then((records) => records[0] ?? null);
}
async function softDeleteFinanceRecord(id) {
    return client_1.prisma.financeRecord.update({
        where: { id, userId: (0, user_context_1.getCurrentUserId)() },
        data: {
            deletedAt: new Date(),
            version: {
                increment: 1,
            },
        },
    });
}
