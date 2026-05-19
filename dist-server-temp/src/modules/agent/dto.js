"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toAgentRunDto = toAgentRunDto;
exports.buildAgentRunDetailDto = buildAgentRunDetailDto;
function toAgentRunDto(run) {
    return {
        id: run.id,
        sessionId: run.sessionId ?? undefined,
        status: run.status,
        inputText: run.inputText,
        model: run.model,
        createdAt: run.createdAt.getTime(),
        updatedAt: run.updatedAt.getTime(),
        version: run.version,
    };
}
function buildAgentRunDetailDto(run, state) {
    const base = toAgentRunDto(run);
    const executedToolCalls = state.executedToolCalls.map((tool) => ({
        id: tool.id,
        toolName: tool.name,
        arguments: tool.arguments,
        status: tool.status ?? (tool.success ? 'completed' : 'failed'),
        result: tool.result && typeof tool.result === 'object'
            ? tool.result
            : tool.result !== undefined
                ? { value: tool.result }
                : undefined,
        errorMessage: tool.error,
        createdAt: tool.createdAt,
    }));
    const pendingToolCalls = (state.pendingToolCalls ?? []).map((tool) => {
        const pending = state.pendingToolExecution && state.pendingToolExecution.id === tool.id
            ? state.pendingToolExecution
            : null;
        return {
            id: tool.id,
            toolName: tool.name,
            arguments: tool.arguments,
            status: pending ? 'waiting_confirmation' : 'pending',
            requiresConfirmation: Boolean(pending),
            result: pending ? { confirmationMessage: pending.confirmationMessage } : undefined,
        };
    });
    return {
        ...base,
        status: state.status,
        messages: state.messages.map((message, index) => ({
            id: `${state.runId}-msg-${index}`,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
        })),
        executedToolCalls,
        pendingToolCalls,
        requiresConfirmation: state.status === 'waiting_confirmation',
        finalText: state.finalText,
        error: state.error ?? undefined,
        iterationCount: state.iterationCount,
        assistantTextChunks: state.assistantTextChunks,
        timeline: state.timeline,
    };
}
