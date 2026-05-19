"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLangSmithTracingEnabled = isLangSmithTracingEnabled;
exports.buildAgentTraceConfig = buildAgentTraceConfig;
exports.traceableIfEnabled = traceableIfEnabled;
const traceable_1 = require("langsmith/traceable");
const config_1 = require("./config");
function sanitizeBaseUrl(baseUrl) {
    if (!baseUrl) {
        return undefined;
    }
    try {
        const url = new URL(baseUrl);
        return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');
    }
    catch {
        return undefined;
    }
}
function isLangSmithTracingEnabled() {
    const config = (0, config_1.loadServerConfig)();
    return config.LANGSMITH_TRACING && config.LANGSMITH_API_KEY.trim().length > 0;
}
function buildAgentTraceConfig(info) {
    const metadata = {
        app: 'table',
        module: 'agent',
        runId: info.runId,
        threadId: info.runId,
        userId: info.userId,
        model: info.model,
        entrypoint: info.entrypoint,
        approved: info.approved,
        toolName: info.toolName,
        toolCallId: info.toolCallId,
        cached: info.cached,
        providerId: info.provider?.id,
        providerFormat: info.provider?.apiFormat,
        providerBaseUrl: sanitizeBaseUrl(info.provider?.baseUrl),
        ls_provider: info.provider?.apiFormat,
        ls_model_name: info.model,
    };
    return {
        tags: [
            'table',
            'agent',
            `entrypoint:${info.entrypoint}`,
            `model:${info.model}`,
            ...(info.provider?.apiFormat ? [`provider:${info.provider.apiFormat}`] : []),
            ...(info.toolName ? [`tool:${info.toolName}`] : []),
        ],
        metadata: Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)),
    };
}
function traceableIfEnabled(fn, config) {
    if (!isLangSmithTracingEnabled()) {
        return fn;
    }
    return (0, traceable_1.traceable)(fn, config);
}
