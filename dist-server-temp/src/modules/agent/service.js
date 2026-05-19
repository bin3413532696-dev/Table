"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentRuntimeStatus = getAgentRuntimeStatus;
exports.getAgentRunList = getAgentRunList;
exports.createAgentRunRecord = createAgentRunRecord;
exports.streamAgentRunRecord = streamAgentRunRecord;
exports.confirmAgentRunTool = confirmAgentRunTool;
exports.streamConfirmAgentRunTool = streamConfirmAgentRunTool;
exports.rejectAgentRunTool = rejectAgentRunTool;
exports.streamRejectAgentRunTool = streamRejectAgentRunTool;
exports.getAgentRunDetail = getAgentRunDetail;
exports.updateAgentRunRecord = updateAgentRunRecord;
exports.deleteAgentRunRecord = deleteAgentRunRecord;
const repository_1 = require("./repository");
const graph_1 = require("./langgraph/graph");
const dto_1 = require("./dto");
const service_1 = require("../providers/service");
const user_context_1 = require("../../shared/user-context");
const postgres_checkpointer_1 = require("./langgraph/postgres-checkpointer");
const langsmith_1 = require("../../shared/langsmith");
function normalizeRunStatus(status) {
    switch (status) {
        case 'running':
        case 'waiting_confirmation':
        case 'completed':
        case 'failed':
        case 'cancelled':
            return status;
        default:
            return 'running';
    }
}
async function getCheckpointState(runId) {
    return graph_1.agentGraph.getState({
        configurable: { thread_id: runId },
    });
}
async function buildRunDetail(runId) {
    const run = await (0, repository_1.findAgentRunById)(runId);
    if (!run) {
        return null;
    }
    try {
        const state = await getCheckpointState(runId);
        if (state?.values) {
            return (0, dto_1.buildAgentRunDetailDto)(run, state.values);
        }
    }
    catch {
        // ignore missing checkpoint data
    }
    const base = (0, dto_1.toAgentRunDto)(run);
    return {
        ...base,
        status: normalizeRunStatus(base.status),
        messages: [],
        executedToolCalls: [],
        pendingToolCalls: [],
        requiresConfirmation: false,
        finalText: '',
        error: undefined,
        timeline: [],
        assistantTextChunks: [],
        iterationCount: 0,
    };
}
function buildEmptyRunState(run, runId) {
    return {
        inputText: run.inputText,
        initialMessages: [],
        provider: {
            id: '',
            name: '',
            apiFormat: 'custom',
            baseUrl: '',
            apiKey: '',
        },
        model: run.model,
        systemPrompt: '',
        messages: [],
        executedToolCalls: [],
        pendingToolCalls: [],
        requiresConfirmation: false,
        pendingToolExecution: null,
        confirmedToolCall: null,
        finalText: '',
        runId,
        userId: '',
        iterationCount: 0,
        status: normalizeRunStatus(run.status),
        error: null,
        assistantTextChunks: [],
        timeline: [],
    };
}
function mergePartialState(base, patch) {
    return {
        ...base,
        ...patch,
        messages: patch.messages ?? base.messages,
        executedToolCalls: patch.executedToolCalls ?? base.executedToolCalls,
        pendingToolCalls: patch.pendingToolCalls ?? base.pendingToolCalls,
        assistantTextChunks: patch.assistantTextChunks ?? base.assistantTextChunks,
        timeline: patch.timeline ?? base.timeline,
        pendingToolExecution: patch.pendingToolExecution ?? base.pendingToolExecution,
        confirmedToolCall: patch.confirmedToolCall ?? base.confirmedToolCall,
        requiresConfirmation: patch.requiresConfirmation ?? base.requiresConfirmation,
        finalText: patch.finalText ?? base.finalText,
        status: patch.status ?? base.status,
        error: patch.error ?? base.error,
    };
}
function toStreamableRun(runRecord, state) {
    return (0, dto_1.buildAgentRunDetailDto)(runRecord, state ?? buildEmptyRunState((0, dto_1.toAgentRunDto)(runRecord), runRecord.id));
}
async function emitGraphChunk(runRecord, chunk, emit, lastState) {
    if (chunk.mode === 'values') {
        const mergedState = mergePartialState(lastState, chunk.data);
        await emit({
            type: 'run_update',
            run: toStreamableRun(runRecord, mergedState),
        });
        return mergedState;
    }
    await emit({
        type: 'langgraph_chunk',
        mode: chunk.mode,
        chunk: chunk.data,
    });
    return lastState;
}
async function getAgentRuntimeStatus() {
    const provider = await (0, service_1.getActiveProviderForCurrentUser)();
    return {
        connected: Boolean(provider?.baseUrl?.trim()),
        selectedModel: provider?.model || 'llama3.2',
        availableModels: provider?.model ? [provider.model] : [],
        provider: provider
            ? {
                id: provider.id,
                name: provider.name,
                apiFormat: provider.apiFormat,
                baseUrl: provider.baseUrl,
                hasApiKey: provider.hasApiKey,
            }
            : null,
    };
}
async function getAgentRunList(input) {
    const { items, total } = await (0, repository_1.listAgentRuns)(input);
    return {
        items: items.map((run) => (0, dto_1.toAgentRunDto)(run)),
        total,
    };
}
async function createAgentRunRecordImpl(input) {
    const provider = await (0, service_1.getRequiredActiveProviderForCurrentUser)();
    const userId = (0, user_context_1.getCurrentUserId)();
    const run = await (0, repository_1.createAgentRun)({
        ...input,
        model: input.model === 'default' ? provider.model || 'default' : input.model,
    });
    const initialMessages = (input.initialMessages || []).filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system');
    const result = await (0, graph_1.executeAgentGraph)({
        inputText: input.inputText,
        initialMessages,
        provider: {
            id: provider.id,
            name: provider.name,
            apiFormat: provider.apiFormat,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: provider.model,
            headers: provider.headers,
        },
        model: run.model,
        runId: run.id,
        userId,
        systemPrompt: '',
    });
    await (0, repository_1.updateAgentRun)(run.id, { status: result.status });
    return buildRunDetail(run.id);
}
async function createAgentRunRecord(input) {
    const provider = await (0, service_1.getRequiredActiveProviderForCurrentUser)();
    const userId = (0, user_context_1.getCurrentUserId)();
    const model = input.model === 'default' ? provider.model || 'default' : input.model;
    const tracedCreateAgentRunRecord = (0, langsmith_1.traceableIfEnabled)(createAgentRunRecordImpl, {
        name: 'agent.create_run',
        run_type: 'chain',
        ...(0, langsmith_1.buildAgentTraceConfig)({
            runId: 'pending',
            userId,
            model,
            entrypoint: 'create',
            provider: {
                id: provider.id,
                apiFormat: provider.apiFormat,
                baseUrl: provider.baseUrl,
            },
        }),
    });
    return tracedCreateAgentRunRecord(input);
}
async function streamAgentRunRecordImpl(input, emit) {
    const provider = await (0, service_1.getRequiredActiveProviderForCurrentUser)();
    const userId = (0, user_context_1.getCurrentUserId)();
    const run = await (0, repository_1.createAgentRun)({
        ...input,
        model: input.model === 'default' ? provider.model || 'default' : input.model,
    });
    const initialMessages = (input.initialMessages || []).filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system');
    await emit({
        type: 'metadata',
        runId: run.id,
        model: run.model,
    });
    let currentState = buildEmptyRunState((0, dto_1.toAgentRunDto)(run), run.id);
    let state;
    try {
        state = await (0, graph_1.streamAgentGraph)({
            inputText: input.inputText,
            initialMessages,
            provider: {
                id: provider.id,
                name: provider.name,
                apiFormat: provider.apiFormat,
                baseUrl: provider.baseUrl,
                apiKey: provider.apiKey,
                model: provider.model,
                headers: provider.headers,
            },
            model: run.model,
            runId: run.id,
            userId,
            systemPrompt: '',
            onChunk: async (chunk) => {
                currentState = await emitGraphChunk(run, chunk, emit, currentState);
            },
        });
    }
    catch (error) {
        await (0, repository_1.updateAgentRun)(run.id, { status: 'failed' });
        throw error;
    }
    await (0, repository_1.updateAgentRun)(run.id, { status: state.status });
    const runRecord = await (0, repository_1.findAgentRunById)(run.id);
    if (!runRecord) {
        throw new Error('Agent run was not created');
    }
    const detail = toStreamableRun(runRecord, state);
    await emit({ type: 'run_completed', run: detail });
    return detail;
}
async function streamAgentRunRecord(input, emit) {
    const provider = await (0, service_1.getRequiredActiveProviderForCurrentUser)();
    const userId = (0, user_context_1.getCurrentUserId)();
    const model = input.model === 'default' ? provider.model || 'default' : input.model;
    const tracedStreamAgentRunRecord = (0, langsmith_1.traceableIfEnabled)(streamAgentRunRecordImpl, {
        name: 'agent.stream_run',
        run_type: 'chain',
        ...(0, langsmith_1.buildAgentTraceConfig)({
            runId: 'pending',
            userId,
            model,
            entrypoint: 'stream',
            provider: {
                id: provider.id,
                apiFormat: provider.apiFormat,
                baseUrl: provider.baseUrl,
            },
        }),
    });
    return tracedStreamAgentRunRecord(input, emit);
}
async function confirmAgentRunToolImpl(runId, toolExecutionId) {
    const current = await buildRunDetail(runId);
    if (!current) {
        return null;
    }
    const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
    if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
        throw new Error('没有待确认的工具执行');
    }
    const result = await (0, graph_1.continueAgentGraph)(runId, true);
    await (0, repository_1.updateAgentRun)(runId, { status: result.status });
    return buildRunDetail(runId);
}
async function confirmAgentRunTool(runId, toolExecutionId) {
    const current = await buildRunDetail(runId);
    if (!current) {
        return null;
    }
    const tracedConfirmAgentRunTool = (0, langsmith_1.traceableIfEnabled)(confirmAgentRunToolImpl, {
        name: 'agent.confirm_tool',
        run_type: 'chain',
        ...(0, langsmith_1.buildAgentTraceConfig)({
            runId,
            model: current.model,
            entrypoint: 'confirm',
            toolCallId: toolExecutionId,
            approved: true,
        }),
    });
    return tracedConfirmAgentRunTool(runId, toolExecutionId);
}
async function streamConfirmAgentRunToolImpl(runId, toolExecutionId, emit) {
    const current = await buildRunDetail(runId);
    if (!current) {
        return null;
    }
    const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
    if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
        throw new Error('娌℃湁寰呯‘璁ょ殑宸ュ叿鎵ц');
    }
    await emit({
        type: 'metadata',
        runId,
        model: current.model,
    });
    const runRecordBefore = await (0, repository_1.findAgentRunById)(runId);
    let currentState = runRecordBefore
        ? buildEmptyRunState((0, dto_1.toAgentRunDto)(runRecordBefore), runId)
        : buildEmptyRunState({
            id: runId,
            sessionId: current.sessionId,
            status: current.status,
            inputText: current.inputText,
            model: current.model,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
            version: current.version,
        }, runId);
    currentState = mergePartialState(currentState, {
        messages: current.messages.map((message) => ({
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
        })),
        finalText: current.finalText,
        iterationCount: current.iterationCount,
        assistantTextChunks: current.assistantTextChunks,
        timeline: current.timeline,
        status: current.status,
        requiresConfirmation: current.requiresConfirmation,
        error: current.error ?? null,
    });
    let state;
    try {
        state = await (0, graph_1.streamContinueAgentGraph)({
            runId,
            approved: true,
            onChunk: async (chunk) => {
                const runRecord = await (0, repository_1.findAgentRunById)(runId);
                if (!runRecord) {
                    return;
                }
                currentState = await emitGraphChunk(runRecord, chunk, emit, currentState);
            },
        });
    }
    catch (error) {
        await (0, repository_1.updateAgentRun)(runId, { status: 'failed' });
        throw error;
    }
    await (0, repository_1.updateAgentRun)(runId, { status: state.status });
    const runRecord = await (0, repository_1.findAgentRunById)(runId);
    if (!runRecord) {
        return null;
    }
    const detail = toStreamableRun(runRecord, state);
    await emit({ type: 'run_completed', run: detail });
    return detail;
}
async function streamConfirmAgentRunTool(runId, toolExecutionId, emit) {
    const current = await buildRunDetail(runId);
    if (!current) {
        return null;
    }
    const tracedStreamConfirmAgentRunTool = (0, langsmith_1.traceableIfEnabled)(streamConfirmAgentRunToolImpl, {
        name: 'agent.stream_confirm_tool',
        run_type: 'chain',
        ...(0, langsmith_1.buildAgentTraceConfig)({
            runId,
            model: current.model,
            entrypoint: 'confirm',
            toolCallId: toolExecutionId,
            approved: true,
        }),
    });
    return tracedStreamConfirmAgentRunTool(runId, toolExecutionId, emit);
}
async function rejectAgentRunToolImpl(runId, toolExecutionId) {
    const current = await buildRunDetail(runId);
    if (!current) {
        return null;
    }
    const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
    if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
        throw new Error('没有待确认的工具执行');
    }
    const result = await (0, graph_1.continueAgentGraph)(runId, false);
    await (0, repository_1.updateAgentRun)(runId, { status: result.status });
    return buildRunDetail(runId);
}
async function rejectAgentRunTool(runId, toolExecutionId) {
    const current = await buildRunDetail(runId);
    if (!current) {
        return null;
    }
    const tracedRejectAgentRunTool = (0, langsmith_1.traceableIfEnabled)(rejectAgentRunToolImpl, {
        name: 'agent.reject_tool',
        run_type: 'chain',
        ...(0, langsmith_1.buildAgentTraceConfig)({
            runId,
            model: current.model,
            entrypoint: 'reject',
            toolCallId: toolExecutionId,
            approved: false,
        }),
    });
    return tracedRejectAgentRunTool(runId, toolExecutionId);
}
async function streamRejectAgentRunToolImpl(runId, toolExecutionId, emit) {
    const current = await buildRunDetail(runId);
    if (!current) {
        return null;
    }
    const pendingTool = current.pendingToolCalls.find((tool) => tool.id === toolExecutionId);
    if (!pendingTool || pendingTool.status !== 'waiting_confirmation') {
        throw new Error('娌℃湁寰呯‘璁ょ殑宸ュ叿鎵ц');
    }
    await emit({
        type: 'metadata',
        runId,
        model: current.model,
    });
    const runRecordBefore = await (0, repository_1.findAgentRunById)(runId);
    let currentState = runRecordBefore
        ? buildEmptyRunState((0, dto_1.toAgentRunDto)(runRecordBefore), runId)
        : buildEmptyRunState({
            id: runId,
            sessionId: current.sessionId,
            status: current.status,
            inputText: current.inputText,
            model: current.model,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
            version: current.version,
        }, runId);
    currentState = mergePartialState(currentState, {
        messages: current.messages.map((message) => ({
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
        })),
        finalText: current.finalText,
        iterationCount: current.iterationCount,
        assistantTextChunks: current.assistantTextChunks,
        timeline: current.timeline,
        status: current.status,
        requiresConfirmation: current.requiresConfirmation,
        error: current.error ?? null,
    });
    let state;
    try {
        state = await (0, graph_1.streamContinueAgentGraph)({
            runId,
            approved: false,
            onChunk: async (chunk) => {
                const runRecord = await (0, repository_1.findAgentRunById)(runId);
                if (!runRecord) {
                    return;
                }
                currentState = await emitGraphChunk(runRecord, chunk, emit, currentState);
            },
        });
    }
    catch (error) {
        await (0, repository_1.updateAgentRun)(runId, { status: 'failed' });
        throw error;
    }
    await (0, repository_1.updateAgentRun)(runId, { status: state.status });
    const runRecord = await (0, repository_1.findAgentRunById)(runId);
    if (!runRecord) {
        return null;
    }
    const detail = toStreamableRun(runRecord, state);
    await emit({ type: 'run_completed', run: detail });
    return detail;
}
async function streamRejectAgentRunTool(runId, toolExecutionId, emit) {
    const current = await buildRunDetail(runId);
    if (!current) {
        return null;
    }
    const tracedStreamRejectAgentRunTool = (0, langsmith_1.traceableIfEnabled)(streamRejectAgentRunToolImpl, {
        name: 'agent.stream_reject_tool',
        run_type: 'chain',
        ...(0, langsmith_1.buildAgentTraceConfig)({
            runId,
            model: current.model,
            entrypoint: 'reject',
            toolCallId: toolExecutionId,
            approved: false,
        }),
    });
    return tracedStreamRejectAgentRunTool(runId, toolExecutionId, emit);
}
async function getAgentRunDetail(id) {
    return buildRunDetail(id);
}
async function updateAgentRunRecord(id, input) {
    const existing = await (0, repository_1.findAgentRunById)(id);
    if (!existing) {
        return null;
    }
    const run = await (0, repository_1.updateAgentRun)(id, input);
    return (0, dto_1.toAgentRunDto)(run);
}
async function deleteAgentRunRecord(id) {
    const deleted = await (0, repository_1.deleteAgentRunById)(id);
    if (!deleted) {
        return null;
    }
    await (0, postgres_checkpointer_1.getCheckpointer)().deleteThread(id);
    return { id: deleted.id, deleted: true };
}
