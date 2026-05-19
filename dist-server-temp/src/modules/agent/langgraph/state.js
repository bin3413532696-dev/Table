"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_TTL_MS = exports.MAX_ITERATIONS = exports.AgentStateAnnotation = void 0;
const langgraph_1 = require("@langchain/langgraph");
exports.AgentStateAnnotation = langgraph_1.Annotation.Root({
    inputText: (langgraph_1.Annotation),
    initialMessages: (langgraph_1.Annotation),
    provider: (langgraph_1.Annotation),
    model: (langgraph_1.Annotation),
    systemPrompt: (langgraph_1.Annotation),
    messages: (0, langgraph_1.Annotation)({
        default: () => [],
        reducer: (_, y) => y ?? [],
    }),
    executedToolCalls: (0, langgraph_1.Annotation)({
        default: () => [],
        reducer: (_, y) => y ?? [],
    }),
    pendingToolCalls: (0, langgraph_1.Annotation)({
        default: () => [],
        reducer: (_, y) => y ?? [],
    }),
    requiresConfirmation: (0, langgraph_1.Annotation)({
        default: () => false,
        reducer: (_, y) => y,
    }),
    pendingToolExecution: (0, langgraph_1.Annotation)({
        default: () => null,
        reducer: (_, y) => y,
    }),
    confirmedToolCall: (0, langgraph_1.Annotation)({
        default: () => null,
        reducer: (_, y) => y,
    }),
    finalText: (0, langgraph_1.Annotation)({
        default: () => '',
        reducer: (_, y) => y,
    }),
    runId: (langgraph_1.Annotation),
    userId: (langgraph_1.Annotation),
    iterationCount: (0, langgraph_1.Annotation)({
        default: () => 0,
        reducer: (_, y) => y,
    }),
    status: (0, langgraph_1.Annotation)({
        default: () => 'running',
        reducer: (_, y) => y,
    }),
    error: (0, langgraph_1.Annotation)({
        default: () => null,
        reducer: (_, y) => y,
    }),
    assistantTextChunks: (0, langgraph_1.Annotation)({
        default: () => [],
        reducer: (_, y) => y ?? [],
    }),
    timeline: (0, langgraph_1.Annotation)({
        default: () => [],
        reducer: (x, y) => [...(x ?? []), ...(y ?? [])],
    }),
});
exports.MAX_ITERATIONS = Number(process.env.MAX_AGENT_ITERATIONS) || 5;
exports.CACHE_TTL_MS = 5000;
