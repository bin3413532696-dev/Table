"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentGraph = void 0;
exports.executeAgentGraph = executeAgentGraph;
exports.streamAgentGraph = streamAgentGraph;
exports.continueAgentGraph = continueAgentGraph;
exports.streamContinueAgentGraph = streamContinueAgentGraph;
const langgraph_1 = require("@langchain/langgraph");
const messages_1 = require("@langchain/core/messages");
const state_1 = require("./state");
const chatModel_1 = require("./chatModel");
const parser_1 = require("./parser");
const prompts_1 = require("./prompts");
const tools_1 = require("./tools");
const postgres_checkpointer_1 = require("./postgres-checkpointer");
const message_manager_1 = require("./message-manager");
const langsmith_1 = require("../../../shared/langsmith");
function now() {
    return Date.now();
}
function isoNow() {
    return new Date().toISOString();
}
const LLM_TIMEOUT_MS = Number(process.env.AGENT_LLM_TIMEOUT_MS) || 30000;
function appendTimeline(state, event) {
    return [...state.timeline, event];
}
async function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
async function executeToolCallInternal(toolCall) {
    const tool = tools_1.allTools.find((t) => t.name === toolCall.name);
    if (!tool) {
        return {
            ...toolCall,
            result: null,
            success: false,
            error: `不支持的工具: ${toolCall.name}`,
            status: 'failed',
            createdAt: now(),
        };
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await tool.invoke(toolCall.arguments);
        return {
            ...toolCall,
            result,
            success: true,
            status: 'completed',
            createdAt: now(),
        };
    }
    catch (error) {
        return {
            ...toolCall,
            result: null,
            success: false,
            error: error instanceof Error ? error.message : '工具执行失败',
            status: 'failed',
            createdAt: now(),
        };
    }
}
async function initNode() {
    return {
        messages: [],
        executedToolCalls: [],
        pendingToolCalls: [],
        iterationCount: 0,
        status: 'running',
        requiresConfirmation: false,
        pendingToolExecution: null,
        confirmedToolCall: null,
        error: null,
        assistantTextChunks: [],
        timeline: [],
        finalText: '',
    };
}
async function buildMessagesNode(state) {
    const timestamp = now();
    const messages = [
        { role: 'system', content: state.systemPrompt || prompts_1.SYSTEM_PROMPT, createdAt: timestamp },
        ...state.initialMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
            .map((m) => ({
            role: m.role,
            content: m.content,
            createdAt: timestamp,
        })),
        { role: 'user', content: state.inputText, createdAt: timestamp },
    ];
    if (state.executedToolCalls.length > 0) {
        messages.push({
            role: 'user',
            content: (0, prompts_1.buildToolResultPrompt)(state.executedToolCalls),
            createdAt: timestamp,
        });
    }
    return { messages };
}
async function callModelNode(state) {
    const chatModel = (0, chatModel_1.createChatModel)(state.provider, state.model);
    let lcMessages = state.messages.map((m) => {
        if (m.role === 'system')
            return new messages_1.SystemMessage(m.content);
        if (m.role === 'assistant')
            return new messages_1.AIMessage(m.content);
        return new messages_1.HumanMessage(m.content);
    });
    const messageManager = message_manager_1.MessageManager.fromProviderConfig(state.provider, state.model);
    lcMessages = (await messageManager.trim(lcMessages));
    const startTs = isoNow();
    const response = await withTimeout(chatModel.invoke(lcMessages), LLM_TIMEOUT_MS, `LLM request (${state.model})`);
    const responseContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return {
        messages: [
            ...state.messages,
            { role: 'assistant', content: responseContent, createdAt: now() },
        ],
        assistantTextChunks: [...state.assistantTextChunks, responseContent],
        timeline: appendTimeline(state, {
            type: 'llm_start',
            timestamp: startTs,
            data: { model: state.model },
        }).concat({
            type: 'llm_end',
            timestamp: isoNow(),
            data: { model: state.model },
        }),
    };
}
async function parseToolsNode(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
        return { pendingToolCalls: [] };
    }
    const { textContent, toolCalls } = (0, parser_1.parseToolCalls)(lastMessage.content);
    return {
        pendingToolCalls: toolCalls,
        messages: [
            ...state.messages.slice(0, -1),
            {
                ...lastMessage,
                content: textContent,
            },
        ],
    };
}
async function checkConfirmationNode(state) {
    if (state.confirmedToolCall) {
        return { requiresConfirmation: false };
    }
    for (const toolCall of state.pendingToolCalls) {
        if ((0, tools_1.requiresConfirmation)(toolCall.name)) {
            return {
                requiresConfirmation: true,
                status: 'waiting_confirmation',
                pendingToolExecution: {
                    id: toolCall.id,
                    toolName: toolCall.name,
                    arguments: toolCall.arguments,
                    confirmationMessage: `即将执行 ${toolCall.name}，参数如下：\n${JSON.stringify(toolCall.arguments, null, 2)}`,
                },
            };
        }
    }
    return { requiresConfirmation: false };
}
async function executeToolsNode(state) {
    const accumulated = [...state.executedToolCalls];
    const pendingConfirmTools = [];
    let nextStatus;
    let nextError;
    let timeline = [...state.timeline];
    for (const toolCall of state.pendingToolCalls) {
        if ((0, tools_1.requiresConfirmation)(toolCall.name)) {
            pendingConfirmTools.push(toolCall);
            continue;
        }
        const startTs = isoNow();
        timeline.push({
            type: 'tool_start',
            timestamp: startTs,
            data: { toolName: toolCall.name, arguments: toolCall.arguments },
        });
        const cached = (0, parser_1.getCachedResult)(toolCall.name, toolCall.arguments);
        if (cached !== null) {
            accumulated.push({
                ...toolCall,
                result: cached,
                success: true,
                status: 'completed',
                createdAt: now(),
            });
            timeline.push({
                type: 'tool_end',
                timestamp: isoNow(),
                data: { toolName: toolCall.name, success: true, cached: true },
            });
            continue;
        }
        const executeTool = (0, langsmith_1.traceableIfEnabled)(executeToolCallInternal, {
            name: 'agent.execute_tool',
            run_type: 'tool',
            ...(0, langsmith_1.buildAgentTraceConfig)({
                runId: state.runId,
                userId: state.userId,
                model: state.model,
                entrypoint: 'graph_execute',
                provider: {
                    id: state.provider.id,
                    apiFormat: state.provider.apiFormat,
                    baseUrl: state.provider.baseUrl,
                },
                toolName: toolCall.name,
                toolCallId: toolCall.id,
            }),
        });
        const executed = await executeTool(toolCall);
        if (executed.success) {
            (0, parser_1.setCachedResult)(toolCall.name, toolCall.arguments, executed.result);
        }
        else if (!nextError) {
            nextStatus = 'failed';
            nextError = executed.error ?? '工具执行失败';
        }
        accumulated.push(executed);
        timeline.push({
            type: 'tool_end',
            timestamp: isoNow(),
            data: { toolName: toolCall.name, success: executed.success },
        });
    }
    return {
        executedToolCalls: accumulated,
        pendingToolCalls: pendingConfirmTools,
        iterationCount: state.iterationCount + 1,
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(nextError !== undefined ? { error: nextError } : {}),
        timeline,
    };
}
async function requestConfirmationNode(state) {
    if (!state.pendingToolExecution) {
        return { status: 'completed' };
    }
    const approved = (0, langgraph_1.interrupt)({
        toolName: state.pendingToolExecution.toolName,
        arguments: state.pendingToolExecution.arguments,
        confirmationMessage: state.pendingToolExecution.confirmationMessage,
    });
    if (!approved) {
        return {
            status: 'cancelled',
            requiresConfirmation: false,
            pendingToolExecution: null,
            pendingToolCalls: [],
            timeline: appendTimeline(state, {
                type: 'interrupted',
                timestamp: isoNow(),
                data: { reason: 'rejected', toolName: state.pendingToolExecution.toolName },
            }),
        };
    }
    return new langgraph_1.Command({
        goto: 'execute_confirmed_tool',
        update: {
            confirmedToolCall: {
                id: state.pendingToolExecution.id,
                name: state.pendingToolExecution.toolName,
                arguments: state.pendingToolExecution.arguments,
            },
            requiresConfirmation: false,
            status: 'running',
            timeline: appendTimeline(state, {
                type: 'confirmation',
                timestamp: isoNow(),
                data: {
                    toolName: state.pendingToolExecution.toolName,
                    arguments: state.pendingToolExecution.arguments,
                },
            }),
        },
    });
}
async function executeConfirmedToolNode(state) {
    if (!state.confirmedToolCall) {
        return {};
    }
    const toolCall = state.confirmedToolCall;
    const timeline = appendTimeline(state, {
        type: 'tool_start',
        timestamp: isoNow(),
        data: { toolName: toolCall.name, arguments: toolCall.arguments, confirmed: true },
    });
    const cached = (0, parser_1.getCachedResult)(toolCall.name, toolCall.arguments);
    let executed;
    if (cached !== null) {
        executed = {
            ...toolCall,
            result: cached,
            success: true,
            status: 'completed',
            createdAt: now(),
        };
    }
    else {
        const executeTool = (0, langsmith_1.traceableIfEnabled)(executeToolCallInternal, {
            name: 'agent.execute_tool',
            run_type: 'tool',
            ...(0, langsmith_1.buildAgentTraceConfig)({
                runId: state.runId,
                userId: state.userId,
                model: state.model,
                entrypoint: 'graph_continue',
                provider: {
                    id: state.provider.id,
                    apiFormat: state.provider.apiFormat,
                    baseUrl: state.provider.baseUrl,
                },
                toolName: toolCall.name,
                toolCallId: toolCall.id,
            }),
        });
        executed = await executeTool(toolCall);
        if (executed.success) {
            (0, parser_1.setCachedResult)(toolCall.name, toolCall.arguments, executed.result);
        }
    }
    return {
        executedToolCalls: [...state.executedToolCalls, executed],
        confirmedToolCall: null,
        pendingToolExecution: null,
        pendingToolCalls: [],
        ...(executed.error ? { error: executed.error, status: 'failed' } : {}),
        timeline: timeline.concat({
            type: 'tool_end',
            timestamp: isoNow(),
            data: { toolName: toolCall.name, success: executed.success, confirmed: true },
        }),
    };
}
async function finalizeNode(state) {
    const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'assistant');
    return {
        finalText: lastAssistant?.content || '',
        status: state.status === 'cancelled' ? 'cancelled' : state.error ? 'failed' : 'completed',
    };
}
function afterParseRouter(state) {
    if (state.status === 'cancelled' || state.status === 'failed')
        return 'finalize';
    if (state.iterationCount >= state_1.MAX_ITERATIONS)
        return 'finalize';
    if (state.pendingToolCalls.length === 0)
        return 'finalize';
    return 'check_confirmation';
}
function afterCheckConfirmationRouter(state) {
    if (state.requiresConfirmation)
        return 'request_confirmation';
    if (state.pendingToolCalls.length > 0)
        return 'execute_tools';
    return 'finalize';
}
function afterExecuteRouter(state) {
    if (state.status === 'cancelled' || state.status === 'failed')
        return 'finalize';
    if (state.iterationCount >= state_1.MAX_ITERATIONS)
        return 'finalize';
    return 'build_messages';
}
const workflow = new langgraph_1.StateGraph(state_1.AgentStateAnnotation)
    .addNode('init', initNode)
    .addNode('build_messages', buildMessagesNode)
    .addNode('call_model', callModelNode)
    .addNode('parse_tools', parseToolsNode)
    .addNode('check_confirmation', checkConfirmationNode)
    .addNode('execute_tools', executeToolsNode)
    .addNode('request_confirmation', requestConfirmationNode, {
    ends: ['execute_confirmed_tool'],
})
    .addNode('execute_confirmed_tool', executeConfirmedToolNode)
    .addNode('finalize', finalizeNode)
    .addEdge('__start__', 'init')
    .addEdge('init', 'build_messages')
    .addEdge('build_messages', 'call_model')
    .addEdge('call_model', 'parse_tools')
    .addConditionalEdges('parse_tools', afterParseRouter)
    .addConditionalEdges('check_confirmation', afterCheckConfirmationRouter)
    .addConditionalEdges('execute_tools', afterExecuteRouter)
    .addConditionalEdges('execute_confirmed_tool', afterExecuteRouter)
    .addEdge('finalize', langgraph_1.END);
exports.agentGraph = workflow.compile({
    checkpointer: (0, postgres_checkpointer_1.getCheckpointer)(),
});
async function resolveFinalState(runId, fallback) {
    const snapshot = await exports.agentGraph.getState({
        configurable: { thread_id: runId },
    });
    if (snapshot?.values) {
        return snapshot.values;
    }
    if (fallback) {
        return fallback;
    }
    throw new Error(`Missing checkpoint state for run ${runId}`);
}
async function executeAgentGraph(input) {
    const initialState = {
        inputText: input.inputText,
        initialMessages: input.initialMessages,
        provider: input.provider,
        model: input.model,
        runId: input.runId,
        userId: input.userId,
        systemPrompt: input.systemPrompt || prompts_1.SYSTEM_PROMPT,
    };
    return exports.agentGraph.invoke(initialState, {
        configurable: {
            thread_id: input.runId,
            ...(0, langsmith_1.buildAgentTraceConfig)({
                runId: input.runId,
                userId: input.userId,
                model: input.model,
                entrypoint: 'graph_execute',
                provider: {
                    id: input.provider.id,
                    apiFormat: input.provider.apiFormat,
                    baseUrl: input.provider.baseUrl,
                },
            }),
        },
    });
}
async function streamAgentGraph(input) {
    const initialState = {
        inputText: input.inputText,
        initialMessages: input.initialMessages,
        provider: input.provider,
        model: input.model,
        runId: input.runId,
        userId: input.userId,
        systemPrompt: input.systemPrompt || prompts_1.SYSTEM_PROMPT,
    };
    const stream = await exports.agentGraph.stream(initialState, {
        configurable: {
            thread_id: input.runId,
            ...(0, langsmith_1.buildAgentTraceConfig)({
                runId: input.runId,
                userId: input.userId,
                model: input.model,
                entrypoint: 'graph_stream',
                provider: {
                    id: input.provider.id,
                    apiFormat: input.provider.apiFormat,
                    baseUrl: input.provider.baseUrl,
                },
            }),
        },
        streamMode: ['values', 'tasks'],
    });
    let lastValues;
    for await (const chunk of stream) {
        if (!Array.isArray(chunk) || chunk.length < 2) {
            continue;
        }
        const [mode, data] = chunk;
        if (mode !== 'values' && mode !== 'tasks') {
            continue;
        }
        if (mode === 'values') {
            lastValues = data;
        }
        await input.onChunk({ mode, data });
    }
    return resolveFinalState(input.runId, lastValues);
}
async function continueAgentGraph(runId, approved) {
    return exports.agentGraph.invoke(new langgraph_1.Command({ resume: approved }), {
        configurable: {
            thread_id: runId,
            ...(0, langsmith_1.buildAgentTraceConfig)({
                runId,
                model: 'resume',
                entrypoint: 'graph_continue',
                approved,
            }),
        },
    });
}
async function streamContinueAgentGraph(input) {
    const stream = await exports.agentGraph.stream(new langgraph_1.Command({ resume: input.approved }), {
        configurable: {
            thread_id: input.runId,
            ...(0, langsmith_1.buildAgentTraceConfig)({
                runId: input.runId,
                model: 'resume',
                entrypoint: 'graph_continue',
                approved: input.approved,
            }),
        },
        streamMode: ['values', 'tasks'],
    });
    let lastValues;
    for await (const chunk of stream) {
        if (!Array.isArray(chunk) || chunk.length < 2) {
            continue;
        }
        const [mode, data] = chunk;
        if (mode !== 'values' && mode !== 'tasks') {
            continue;
        }
        if (mode === 'values') {
            lastValues = data;
        }
        await input.onChunk({ mode, data });
    }
    return resolveFinalState(input.runId, lastValues);
}
