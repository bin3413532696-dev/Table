"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadServerConfig = loadServerConfig;
const dotenv_1 = require("dotenv");
const zod_1 = require("zod");
(0, dotenv_1.config)();
// Zod 的 z.coerce.boolean() 对 "false" 字符串返回 true（因为 Boolean("false") === true）
// 使用预处理来正确解析环境变量中的 boolean
const booleanSchema = zod_1.z.preprocess((val) => {
    if (typeof val === 'string') {
        return val === 'true' || val === '1';
    }
    return Boolean(val);
}, zod_1.z.boolean());
const envSchema = zod_1.z.object({
    SERVER_HOST: zod_1.z.string().default('127.0.0.1'),
    SERVER_PORT: zod_1.z.coerce.number().int().positive().default(8787),
    DATABASE_URL: zod_1.z.string().default('postgresql://postgres:postgres@127.0.0.1:5432/table_dev'),
    ALLOW_DEFAULT_USER_FALLBACK: booleanSchema.default(false),
    TRUST_USER_ID_HEADER: booleanSchema.default(false),
    DEFAULT_USER_ID: zod_1.z.string().uuid().default('00000000-0000-0000-0000-000000000001'),
    PROVIDER_SECRET_KEY: zod_1.z.string().min(16).default('table-dev-provider-secret-key-change-me'),
    DEFAULT_PROVIDER_NAME: zod_1.z.string().default('GLM-5 Provider'),
    DEFAULT_PROVIDER_FORMAT: zod_1.z.enum(['anthropic', 'openai', 'gemini', 'custom']).default('openai'),
    DEFAULT_PROVIDER_BASE_URL: zod_1.z.string().default(''),
    DEFAULT_PROVIDER_API_KEY: zod_1.z.string().default(''),
    DEFAULT_PROVIDER_MODEL: zod_1.z.string().default(''),
    LANGSMITH_TRACING: booleanSchema.default(false),
    LANGCHAIN_CALLBACKS_BACKGROUND: booleanSchema.default(true),
    LANGSMITH_API_KEY: zod_1.z.string().default(''),
    LANGSMITH_ENDPOINT: zod_1.z.string().default('https://api.smith.langchain.com'),
    LANGSMITH_PROJECT: zod_1.z.string().default('table-agent'),
    LANGSMITH_WORKSPACE_ID: zod_1.z.string().default(''),
    PROJECTION_OUTBOX_POLL_MS: zod_1.z.coerce.number().int().positive().default(1500),
    PROJECTION_OUTBOX_BATCH_SIZE: zod_1.z.coerce.number().int().positive().max(100).default(20),
});
function loadServerConfig() {
    const config = envSchema.parse(process.env);
    if (config.PROVIDER_SECRET_KEY === 'table-dev-provider-secret-key-change-me') {
        if (process.env.NODE_ENV === 'production') {
            console.error('[SECURITY] FATAL: PROVIDER_SECRET_KEY is using the default value in production. Refusing to start.');
            process.exit(1);
        }
        console.error('[SECURITY] PROVIDER_SECRET_KEY is using the default value. Set a strong secret before deploying to production.');
    }
    if (config.ALLOW_DEFAULT_USER_FALLBACK && config.DEFAULT_USER_ID === '00000000-0000-0000-0000-000000000001') {
        if (process.env.NODE_ENV === 'production') {
            console.error('[SECURITY] FATAL: DEFAULT_USER_ID is using the publicly known default UUID with fallback enabled in production. Refusing to start.');
            process.exit(1);
        }
        console.error('[SECURITY] DEFAULT_USER_ID is using the publicly known default UUID with fallback enabled. This is insecure for production.');
    }
    return config;
}
