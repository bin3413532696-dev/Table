"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allTools = exports.toolMetadata = exports.deleteTaskTool = exports.updateTaskTool = exports.addFinanceRecordTool = exports.createTaskTool = exports.searchKnowledgeTool = exports.getFinanceStatsTool = exports.queryFinanceTool = exports.getTaskStatsTool = exports.queryTasksTool = void 0;
exports.requiresConfirmation = requiresConfirmation;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const repository_1 = require("../../tasks/repository");
const dto_1 = require("../../tasks/dto");
const repository_2 = require("../../finance/repository");
const dto_2 = require("../../finance/dto");
const repository_3 = require("../../knowledge/repository");
const repository_4 = require("../../tasks/repository");
const taskPriorityEnum = zod_1.z.enum(['low', 'medium', 'high']);
function normalizeTaskPriority(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    const priorityMap = {
        low: 'low',
        medium: 'medium',
        high: 'high',
        l: 'low',
        m: 'medium',
        h: 'high',
        '低': 'low',
        '低优先级': 'low',
        '低优先': 'low',
        '中': 'medium',
        '中等': 'medium',
        '中优先级': 'medium',
        '中优先': 'medium',
        '普通': 'medium',
        '默认': 'medium',
        '高': 'high',
        '高优先级': 'high',
        '高优先': 'high',
        '重要': 'high',
        '紧急': 'high',
    };
    return priorityMap[normalized];
}
const taskPriorityInputSchema = zod_1.z.preprocess((value) => {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    return normalizeTaskPriority(value) ?? value;
}, taskPriorityEnum.optional());
exports.queryTasksTool = (0, tools_1.tool)(async ({ completed, priority, limit }) => {
    const tasks = await (0, repository_1.listTasks)();
    return tasks
        .filter((task) => completed === undefined || task.completed === completed)
        .filter((task) => !priority || task.priority === priority)
        .slice(0, limit || 20)
        .map(dto_1.toTaskDto);
}, {
    name: 'query_tasks',
    description: '查询任务列表，可按完成状态和优先级筛选。',
    schema: zod_1.z.object({
        completed: zod_1.z.boolean().optional().describe('是否已完成'),
        priority: taskPriorityInputSchema.describe('优先级，支持 low/medium/high 或 高/中/低'),
        limit: zod_1.z.number().max(100).default(20).describe('返回数量限制'),
    }),
});
exports.getTaskStatsTool = (0, tools_1.tool)(async () => {
    const tasks = await (0, repository_1.listTasks)();
    const completed = tasks.filter((task) => task.completed).length;
    const overdue = tasks.filter((task) => {
        if (!task.dueDate || task.completed)
            return false;
        return task.dueDate.getTime() < Date.now();
    }).length;
    return {
        total: tasks.length,
        completed,
        pending: tasks.length - completed,
        overdue,
    };
}, {
    name: 'get_task_stats',
    description: '获取任务统计数据。',
    schema: zod_1.z.object({}),
});
exports.queryFinanceTool = (0, tools_1.tool)(async ({ type, category, startDate, endDate, limit }) => {
    const records = await (0, repository_2.listFinanceRecords)();
    let filtered = records;
    if (type && type !== 'all') {
        filtered = filtered.filter((record) => record.type === type);
    }
    if (category) {
        filtered = filtered.filter((record) => record.category === category);
    }
    if (startDate) {
        const start = new Date(startDate);
        filtered = filtered.filter((record) => record.recordDate >= start);
    }
    if (endDate) {
        const end = new Date(endDate);
        filtered = filtered.filter((record) => record.recordDate <= end);
    }
    return filtered.slice(0, limit || 50).map(dto_2.toFinanceRecordDto);
}, {
    name: 'query_finance',
    description: '查询财务记录，可按类型、分类、日期范围筛选。',
    schema: zod_1.z.object({
        type: zod_1.z.enum(['income', 'expense', 'all']).optional().default('all').describe('记录类型'),
        category: zod_1.z.string().max(50).optional().describe('分类'),
        startDate: zod_1.z.string().optional().describe('开始日期'),
        endDate: zod_1.z.string().optional().describe('结束日期'),
        limit: zod_1.z.number().max(100).default(50).describe('返回数量限制'),
    }),
});
exports.getFinanceStatsTool = (0, tools_1.tool)(async () => {
    const records = await (0, repository_2.listFinanceRecords)();
    const income = records
        .filter((record) => record.type === 'income')
        .reduce((sum, record) => sum + Number(record.amount), 0);
    const expense = records
        .filter((record) => record.type === 'expense')
        .reduce((sum, record) => sum + Number(record.amount), 0);
    return {
        totalRecords: records.length,
        totalIncome: income,
        totalExpense: expense,
        balance: income - expense,
    };
}, {
    name: 'get_finance_stats',
    description: '获取财务统计数据。',
    schema: zod_1.z.object({}),
});
exports.searchKnowledgeTool = (0, tools_1.tool)(async ({ query, tags, limit }) => {
    return (0, repository_3.searchNotes)({
        query: query || '',
        tags: tags || undefined,
        limit: limit || 8,
        offset: 0,
    });
}, {
    name: 'search_knowledge',
    description: '搜索知识库笔记。',
    schema: zod_1.z.object({
        query: zod_1.z.string().max(200).optional().describe('搜索关键词'),
        tags: zod_1.z.array(zod_1.z.string().max(50)).max(10).optional().describe('标签筛选'),
        limit: zod_1.z.number().max(20).default(8).describe('返回数量限制'),
    }),
});
exports.createTaskTool = (0, tools_1.tool)(async ({ title, description, priority, dueDate }) => {
    const task = await (0, repository_4.createTask)({
        title: title.trim(),
        notes: description?.trim() || undefined,
        priority: priority || 'medium',
        dueDate: dueDate || undefined,
    });
    return (0, dto_1.toTaskDto)(task);
}, {
    name: 'create_task',
    description: '创建新任务，需要用户确认。',
    schema: zod_1.z.object({
        title: zod_1.z.string().trim().min(1).max(200).describe('任务标题'),
        description: zod_1.z.string().trim().max(500).optional().describe('任务描述'),
        priority: taskPriorityInputSchema.describe('优先级，支持 low/medium/high 或 高/中/低'),
        dueDate: zod_1.z.string().trim().max(30).optional().describe('截止日期'),
    }),
});
exports.addFinanceRecordTool = (0, tools_1.tool)(async ({ type, amount, description, category, date }) => {
    const record = await (0, repository_2.createFinanceRecord)({
        type,
        amount,
        description: description.trim(),
        category: category.trim(),
        date,
    });
    return (0, dto_2.toFinanceRecordDto)(record);
}, {
    name: 'add_finance_record',
    description: '新增财务记录，需要用户确认。',
    schema: zod_1.z.object({
        type: zod_1.z.enum(['income', 'expense']).describe('记录类型'),
        amount: zod_1.z.number().min(0).max(999999999.99).describe('金额'),
        description: zod_1.z.string().trim().min(1).max(500).describe('描述'),
        category: zod_1.z.string().trim().min(1).max(50).describe('分类'),
        date: zod_1.z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).describe('日期，格式 YYYY-MM-DD'),
    }),
});
exports.updateTaskTool = (0, tools_1.tool)(async ({ id, title, completed, priority, dueDate }) => {
    const existing = await (0, repository_4.findTaskById)(id);
    if (!existing) {
        throw new Error(`未找到任务 ${id}`);
    }
    const updated = await (0, repository_4.updateTask)(id, {
        ...(title ? { title: title.trim() } : {}),
        ...(completed !== undefined ? { completed } : {}),
        ...(priority ? { priority } : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate || null } : {}),
        version: existing.version,
    });
    if (!updated) {
        throw new Error(`任务已被其他请求修改: ${id}`);
    }
    return (0, dto_1.toTaskDto)(updated);
}, {
    name: 'update_task',
    description: '更新任务，需要用户确认。',
    schema: zod_1.z.object({
        id: zod_1.z.string().uuid().describe('任务 ID'),
        title: zod_1.z.string().trim().min(1).max(200).optional().describe('新标题'),
        completed: zod_1.z.boolean().optional().describe('完成状态'),
        priority: taskPriorityInputSchema.describe('优先级，支持 low/medium/high 或 高/中/低'),
        dueDate: zod_1.z.string().trim().max(30).optional().describe('截止日期'),
    }),
});
exports.deleteTaskTool = (0, tools_1.tool)(async ({ id }) => {
    const existing = await (0, repository_4.findTaskById)(id);
    if (!existing) {
        throw new Error(`未找到任务 ${id}`);
    }
    const deleted = await (0, repository_4.softDeleteTask)(id);
    return {
        id: deleted.id,
        deleted: true,
    };
}, {
    name: 'delete_task',
    description: '删除任务，需要用户确认。',
    schema: zod_1.z.object({
        id: zod_1.z.string().uuid().describe('任务 ID'),
    }),
});
exports.toolMetadata = {
    query_tasks: { requiresConfirmation: false },
    get_task_stats: { requiresConfirmation: false },
    query_finance: { requiresConfirmation: false },
    get_finance_stats: { requiresConfirmation: false },
    search_knowledge: { requiresConfirmation: false },
    create_task: { requiresConfirmation: true },
    add_finance_record: { requiresConfirmation: true },
    update_task: { requiresConfirmation: true },
    delete_task: { requiresConfirmation: true },
};
exports.allTools = [
    exports.queryTasksTool,
    exports.getTaskStatsTool,
    exports.queryFinanceTool,
    exports.getFinanceStatsTool,
    exports.searchKnowledgeTool,
    exports.createTaskTool,
    exports.addFinanceRecordTool,
    exports.updateTaskTool,
    exports.deleteTaskTool,
];
function requiresConfirmation(toolName) {
    return exports.toolMetadata[toolName]?.requiresConfirmation ?? false;
}
