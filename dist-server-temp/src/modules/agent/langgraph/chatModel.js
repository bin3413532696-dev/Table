"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProviderUrl = validateProviderUrl;
exports.createChatModel = createChatModel;
exports.createStreamingChatModel = createStreamingChatModel;
const anthropic_1 = require("@langchain/anthropic");
const openai_1 = require("@langchain/openai");
const google_genai_1 = require("@langchain/google-genai");
/**
 * ChatModel 适配层
 * 根据 Provider 配置创建对应的 LangChain ChatModel
 */
/**
 * 验证 Provider baseUrl，防止 SSRF
 * - 仅允许 HTTPS 协议
 * - 阻止内网 IP 和云元数据地址
 */
function validateProviderUrl(baseUrl) {
    let url;
    try {
        url = new URL(baseUrl);
    }
    catch {
        throw new Error(`Provider baseUrl 格式无效: ${baseUrl}`);
    }
    // 仅允许 HTTPS 协议
    if (url.protocol !== 'https:') {
        throw new Error(`Provider baseUrl 必须使用 HTTPS 协议，当前为: ${url.protocol}`);
    }
    const hostname = url.hostname.toLowerCase();
    // 阻止 localhost
    if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
        throw new Error('Provider baseUrl 不允许指向 localhost');
    }
    // 阻止云元数据地址
    if (hostname === '169.254.169.254') {
        throw new Error('Provider baseUrl 不允许指向云元数据地址');
    }
    // 阻止内网 IP 段
    const privateIpPatterns = [
        /^10\.\d+\.\d+\.\d+$/,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/,
        /^192\.168\.\d+\.\d+$/,
        /^127\.\d+\.\d+\.\d+$/,
        /^0\.0\.0\.0$/,
        /^::1$/,
        /^fc00:\/\//i,
        /^fe80:\/\//i,
    ];
    for (const pattern of privateIpPatterns) {
        if (pattern.test(hostname)) {
            throw new Error(`Provider baseUrl 不允许指向内网地址: ${hostname}`);
        }
    }
}
/**
 * 创建 ChatModel 实例
 */
function createChatModel(provider, model) {
    // 验证 baseUrl
    validateProviderUrl(provider.baseUrl);
    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    switch (provider.apiFormat) {
        case 'anthropic':
            return new anthropic_1.ChatAnthropic({
                anthropicApiKey: provider.apiKey,
                modelName: model,
                maxTokens: 4096,
                clientOptions: {
                    baseURL: baseUrl,
                },
            });
        case 'openai':
            return new openai_1.ChatOpenAI({
                apiKey: provider.apiKey,
                modelName: model,
                maxTokens: 4096,
                configuration: {
                    baseURL: baseUrl,
                },
            });
        case 'custom':
            // Custom 格式使用 OpenAI-compatible API
            return new openai_1.ChatOpenAI({
                apiKey: provider.apiKey,
                modelName: model,
                maxTokens: 4096,
                configuration: {
                    baseURL: baseUrl,
                    defaultHeaders: provider.headers,
                },
            });
        case 'gemini':
            return new google_genai_1.ChatGoogleGenerativeAI({
                apiKey: provider.apiKey,
                model: model,
                maxOutputTokens: 4096,
                // Gemini 不支持自定义 baseUrl，使用 Google 官方 API
            });
        default:
            throw new Error(`不支持的 Provider API 格式: ${provider.apiFormat}`);
    }
}
/**
 * 创建流式 ChatModel 实例
 */
function createStreamingChatModel(provider, model) {
    const modelInstance = createChatModel(provider, model);
    // 设置流式模式
    if (modelInstance instanceof openai_1.ChatOpenAI) {
        modelInstance.streaming = true;
    }
    return modelInstance;
}
