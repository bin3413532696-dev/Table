"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAgentRuns = listAgentRuns;
exports.findAgentRunById = findAgentRunById;
exports.createAgentRun = createAgentRun;
exports.updateAgentRun = updateAgentRun;
exports.deleteAgentRunById = deleteAgentRunById;
const client_1 = require("../../db/client");
const user_context_1 = require("../../shared/user-context");
/**
 * 极简 Repository - 只操作 AgentRun 表
 * 所有对话历史和状态都由 LangGraph Checkpoint 存储
 */
async function listAgentRuns(input) {
    const whereClause = {
        userId: (0, user_context_1.getCurrentUserId)(),
        ...(input.status ? { status: input.status } : {}),
    };
    const [items, total] = await Promise.all([
        client_1.prisma.agentRun.findMany({
            where: whereClause,
            orderBy: {
                createdAt: 'desc',
            },
            take: input.limit,
            skip: input.offset,
        }),
        client_1.prisma.agentRun.count({
            where: whereClause,
        }),
    ]);
    return { items, total };
}
async function findAgentRunById(id) {
    return client_1.prisma.agentRun.findFirst({
        where: {
            id,
            userId: (0, user_context_1.getCurrentUserId)(),
        },
    });
}
async function createAgentRun(input) {
    return client_1.prisma.agentRun.create({
        data: {
            userId: (0, user_context_1.getCurrentUserId)(),
            sessionId: input.sessionId,
            status: 'pending',
            inputText: input.inputText,
            model: input.model,
        },
    });
}
async function updateAgentRun(id, input) {
    return client_1.prisma.agentRun.update({
        where: {
            id,
            userId: (0, user_context_1.getCurrentUserId)(),
        },
        data: {
            ...(input.status !== undefined ? { status: input.status } : {}),
            version: {
                increment: 1,
            },
        },
    });
}
async function deleteAgentRunById(id) {
    const existing = await client_1.prisma.agentRun.findFirst({
        where: {
            id,
            userId: (0, user_context_1.getCurrentUserId)(),
        },
    });
    if (!existing) {
        return null;
    }
    return client_1.prisma.agentRun.delete({
        where: {
            id,
        },
    });
}
