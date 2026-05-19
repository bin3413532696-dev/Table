"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseToolCalls = parseToolCalls;
exports.getCachedResult = getCachedResult;
exports.setCachedResult = setCachedResult;
const crypto_1 = require("crypto");
/**
 * 工具调用解析器
 * 复用 executor.ts 中的解析逻辑
 */
/**
 * 从内容中提取内联 JSON 工具调用
 */
function extractInlineToolJson(content) {
    const candidates = [];
    let searchStart = 0;
    while (searchStart < content.length) {
        const nameIndex = content.indexOf('"name"', searchStart);
        if (nameIndex === -1)
            break;
        const start = content.lastIndexOf('{', nameIndex);
        if (start === -1)
            break;
        let depth = 0;
        let inString = false;
        let escaped = false;
        let end = -1;
        for (let index = start; index < content.length; index += 1) {
            const char = content[index];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === '"') {
                inString = !inString;
                continue;
            }
            if (inString)
                continue;
            if (char === '{') {
                depth += 1;
            }
            else if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    end = index;
                    break;
                }
            }
        }
        if (end === -1)
            break;
        const candidate = content.slice(start, end + 1).trim();
        if (candidate.includes('"arguments"')) {
            candidates.push(candidate);
        }
        searchStart = end + 1;
    }
    return candidates;
}
/**
 * 解析工具调用
 * 支持 tool 代码块、json 代码块、内联 JSON 三种格式
 */
function parseToolCalls(content) {
    const toolCalls = [];
    const toolBlockRegex = /```tool\s*\n?([\s\S]*?)```/g;
    const jsonBlockRegex = /```json\s*\n?([\s\S]*?)```/g;
    // 解析 tool 代码块
    let match;
    while ((match = toolBlockRegex.exec(content)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            if (parsed.name && typeof parsed.name === 'string') {
                toolCalls.push({
                    id: (0, crypto_1.randomUUID)(),
                    name: parsed.name,
                    arguments: parsed.arguments || {},
                });
            }
        }
        catch (error) {
            console.error('[LangGraph] Failed to parse tool block:', error);
        }
    }
    // 解析 json 代码块
    while ((match = jsonBlockRegex.exec(content)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            if (parsed.name && typeof parsed.name === 'string' && parsed.arguments) {
                toolCalls.push({
                    id: (0, crypto_1.randomUUID)(),
                    name: parsed.name,
                    arguments: parsed.arguments,
                });
            }
        }
        catch (error) {
            console.error('[LangGraph] Failed to parse JSON tool block:', error);
        }
    }
    // 解析内联 JSON
    for (const candidate of extractInlineToolJson(content)) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed.name && typeof parsed.name === 'string') {
                toolCalls.push({
                    id: (0, crypto_1.randomUUID)(),
                    name: parsed.name,
                    arguments: parsed.arguments || {},
                });
            }
        }
        catch (error) {
            console.error('[LangGraph] Failed to parse inline tool JSON:', error);
        }
    }
    // 去重
    const seen = new Set();
    const uniqueToolCalls = toolCalls.filter((toolCall) => {
        const key = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    // 提取纯文本内容
    const textContent = content
        .replace(toolBlockRegex, '')
        .replace(jsonBlockRegex, '')
        .replace(/\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, '')
        .trim();
    return { textContent, toolCalls: uniqueToolCalls };
}
/**
 * 查询类工具缓存
 */
const queryCache = new Map();
const CACHE_TTL_MS = 5000;
function getCacheKey(toolName, args) {
    return `${toolName}:${JSON.stringify(args)}`;
}
function getCachedResult(toolName, args) {
    const key = getCacheKey(toolName, args);
    const cached = queryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }
    queryCache.delete(key);
    return null;
}
function setCachedResult(toolName, args, result) {
    const now = Date.now();
    // 清理过期缓存
    for (const [key, entry] of queryCache) {
        if (entry.expiresAt <= now) {
            queryCache.delete(key);
        }
    }
    const key = getCacheKey(toolName, args);
    queryCache.set(key, { result, expiresAt: now + CACHE_TTL_MS });
}
