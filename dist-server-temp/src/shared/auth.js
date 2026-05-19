"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthError = exports.CSRF_HEADER_NAME = exports.CSRF_COOKIE_NAME = void 0;
exports.generateCsrfToken = generateCsrfToken;
exports.validateCsrfToken = validateCsrfToken;
exports.getCsrfTokenFromRequest = getCsrfTokenFromRequest;
exports.provisionUser = provisionUser;
exports.authenticateRequest = authenticateRequest;
exports.runAuthenticatedRequest = runAuthenticatedRequest;
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const client_1 = require("../db/client");
const service_1 = require("../modules/providers/service");
const user_context_1 = require("./user-context");
const config_1 = require("./config");
const userIdSchema = zod_1.z.string().uuid();
// Intentionally never cleaned: entries persist for server lifetime to avoid redundant baseline checks.
const baselineReadyUsers = new Set();
const baselineInFlight = new Map();
// CSRF Token 配置
exports.CSRF_COOKIE_NAME = 'table_dev_csrf_token';
exports.CSRF_HEADER_NAME = 'x-csrf-token';
/**
 * 生成 CSRF Token（32 字节随机）
 */
function generateCsrfToken() {
    return (0, node_crypto_1.randomBytes)(32).toString('hex');
}
/**
 * 验证 CSRF Token：请求头中的 Token 必须匹配 Cookie 中的
 */
function validateCsrfToken(request) {
    // 从 Cookie 头中解析 CSRF Token
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
        return false;
    }
    const cookies = cookieHeader.split(';');
    let cookieToken = null;
    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === exports.CSRF_COOKIE_NAME && value) {
            cookieToken = value;
            break;
        }
    }
    const headerToken = request.headers[exports.CSRF_HEADER_NAME];
    if (typeof headerToken !== 'string' || !headerToken) {
        return false;
    }
    if (!cookieToken) {
        return false;
    }
    return cookieToken === headerToken;
}
/**
 * 从请求 Cookie 中读取 CSRF Token
 */
function getCsrfTokenFromRequest(request) {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
        return null;
    }
    const cookies = cookieHeader.split(';');
    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === exports.CSRF_COOKIE_NAME && value) {
            return value;
        }
    }
    return null;
}
function computeProviderConfigHash(baseUrl, apiKey, model) {
    // 先对 apiKey 单独哈希，防止通过配置哈希反推 apiKey
    const hashedApiKey = (0, node_crypto_1.createHash)('sha256').update(apiKey).digest('hex');
    return (0, node_crypto_1.createHash)('sha256').update(`${baseUrl}|${hashedApiKey}|${model}`).digest('hex').slice(0, 16);
}
class AuthError extends Error {
    constructor(message, statusCode, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = 'AuthError';
    }
}
exports.AuthError = AuthError;
function ensureValidUserContext(context) {
    if (context.source === 'missing') {
        const config = (0, config_1.loadServerConfig)();
        if (!config.ALLOW_DEFAULT_USER_FALLBACK) {
            throw new AuthError(`Missing ${user_context_1.USER_ID_HEADER} header`, 401, 'UNAUTHORIZED');
        }
        return;
    }
    const parsed = userIdSchema.safeParse(context.userId);
    if (!parsed.success) {
        throw new AuthError(`Invalid ${user_context_1.USER_ID_HEADER} header`, 401, 'UNAUTHORIZED');
    }
}
async function ensureUserRecordExists(context) {
    const existing = await client_1.prisma.user.findUnique({
        where: {
            id: context.userId,
        },
    });
    if (existing) {
        if (existing.status !== 'active') {
            throw new AuthError('User is not active', 403, 'FORBIDDEN');
        }
        return existing;
    }
    if (context.userId !== (0, user_context_1.getDefaultUserId)()) {
        throw new AuthError('User not found. Please create the user first.', 401, 'UNAUTHORIZED');
    }
    const fallbackName = context.userId === (0, user_context_1.getDefaultUserId)()
        ? 'Default Local User'
        : `User ${context.userId.slice(0, 8)}`;
    return client_1.prisma.user.create({
        data: {
            id: context.userId,
            displayName: fallbackName,
            status: 'active',
        },
    });
}
async function ensureUserBaseline(context) {
    const config = (0, config_1.loadServerConfig)();
    const currentEnvHash = computeProviderConfigHash(config.DEFAULT_PROVIDER_BASE_URL, config.DEFAULT_PROVIDER_API_KEY, config.DEFAULT_PROVIDER_MODEL);
    const existingSettings = await client_1.prisma.userSetting.findUnique({
        where: {
            userId: context.userId,
        },
    });
    if (!existingSettings) {
        await client_1.prisma.userSetting.create({
            data: {
                userId: context.userId,
                theme: 'light',
                profile_json: {},
                notification_json: {},
                agentPreferencesJson: {},
                providerConfigHash: currentEnvHash,
            },
        });
    }
    const existingProviders = await (0, service_1.listProvidersForCurrentUser)();
    const bootstrapProvider = existingProviders.find(p => p.source === 'bootstrap');
    // 兼容旧数据：如果没有 bootstrap provider 但有一个 provider 且用户没有手动创建过，使用它
    const legacyProvider = !bootstrapProvider && existingProviders.length === 1 ? existingProviders[0] : null;
    // 如果没有任何 provider，需要创建一个（无论 settings 是否已存在）
    const needsNewProvider = existingProviders.length === 0;
    const shouldBootstrapWorkspace = !existingSettings &&
        existingProviders.length === 0;
    // 检测 .env 配置变更，自动同步 bootstrap Provider 或 legacy Provider
    const providerToSync = bootstrapProvider || legacyProvider;
    if (providerToSync && existingSettings) {
        const storedHash = existingSettings.providerConfigHash;
        if (storedHash !== currentEnvHash && config.DEFAULT_PROVIDER_BASE_URL.trim()) {
            // 配置变更，需要同步更新 Provider
            await (0, service_1.updateProviderForCurrentUser)(providerToSync.id, {
                name: config.DEFAULT_PROVIDER_NAME,
                apiFormat: config.DEFAULT_PROVIDER_FORMAT,
                baseUrl: config.DEFAULT_PROVIDER_BASE_URL,
                apiKey: config.DEFAULT_PROVIDER_API_KEY,
                model: config.DEFAULT_PROVIDER_MODEL,
            });
            // 更新哈希
            await client_1.prisma.userSetting.update({
                where: { userId: context.userId },
                data: { providerConfigHash: currentEnvHash },
            });
        }
    }
    else if (shouldBootstrapWorkspace) {
        const config = (0, config_1.loadServerConfig)();
        if (config.DEFAULT_PROVIDER_BASE_URL.trim()) {
            await (0, service_1.createProviderForCurrentUser)({
                name: config.DEFAULT_PROVIDER_NAME,
                apiFormat: config.DEFAULT_PROVIDER_FORMAT,
                baseUrl: config.DEFAULT_PROVIDER_BASE_URL,
                apiKey: config.DEFAULT_PROVIDER_API_KEY,
                model: config.DEFAULT_PROVIDER_MODEL,
                headers: {},
                isActive: true,
                source: 'bootstrap',
            });
        }
    }
    // 如果没有任何 provider，创建一个（用于已存在 settings 的旧用户）
    if (needsNewProvider && !bootstrapProvider && !legacyProvider) {
        const config = (0, config_1.loadServerConfig)();
        if (config.DEFAULT_PROVIDER_BASE_URL.trim()) {
            await (0, service_1.createProviderForCurrentUser)({
                name: config.DEFAULT_PROVIDER_NAME,
                apiFormat: config.DEFAULT_PROVIDER_FORMAT,
                baseUrl: config.DEFAULT_PROVIDER_BASE_URL,
                apiKey: config.DEFAULT_PROVIDER_API_KEY,
                model: config.DEFAULT_PROVIDER_MODEL,
                headers: {},
                isActive: true,
                source: 'bootstrap',
            });
            // 如果 settings 存在但没有 hash，更新它
            if (existingSettings && !existingSettings.providerConfigHash) {
                await client_1.prisma.userSetting.update({
                    where: { userId: context.userId },
                    data: { providerConfigHash: currentEnvHash },
                });
            }
        }
    }
    if (shouldBootstrapWorkspace) {
        // 更新 bootstrap Provider 的哈希（如果刚创建）
        await client_1.prisma.userSetting.update({
            where: { userId: context.userId },
            data: { providerConfigHash: currentEnvHash },
        });
        const [taskCount, financeCount] = await Promise.all([
            client_1.prisma.task.count({
                where: {
                    userId: context.userId,
                    deletedAt: null,
                },
            }),
            client_1.prisma.financeRecord.count({
                where: {
                    userId: context.userId,
                    deletedAt: null,
                },
            }),
        ]);
        if (taskCount !== 0 || financeCount !== 0) {
            return;
        }
        await client_1.prisma.$transaction(async (tx) => {
            await tx.task.createMany({
                data: [
                    {
                        userId: context.userId,
                        title: '梳理存储层改造边界',
                        completed: false,
                        priority: 'high',
                        dueDate: new Date('2026-05-10'),
                        notes: '明确前后端职责与迁移路径',
                    },
                    {
                        userId: context.userId,
                        title: '落地 PostgreSQL 权威写路径',
                        completed: true,
                        priority: 'medium',
                        dueDate: new Date('2026-05-03'),
                        notes: '第一阶段基础能力',
                    },
                ],
            });
            await tx.financeRecord.createMany({
                data: [
                    {
                        userId: context.userId,
                        type: 'expense',
                        amount: 299.0,
                        category: 'infrastructure',
                        description: 'PostgreSQL 环境准备',
                        recordDate: new Date('2026-05-04'),
                        model: 'backend',
                        metadataJson: {},
                    },
                    {
                        userId: context.userId,
                        type: 'income',
                        amount: 1200.0,
                        category: 'project',
                        description: '阶段性项目结算',
                        recordDate: new Date('2026-05-01'),
                        model: 'delivery',
                        metadataJson: {},
                    },
                ],
            });
            await tx.knowledgeNote.createMany({
                data: [
                    {
                        userId: context.userId,
                        title: '系统架构设计笔记',
                        content: '采用 Fastify + Prisma + PostgreSQL 的后端架构',
                        tagsJson: ['architecture', 'backend'],
                    },
                ],
            });
            await tx.knowledgePresetTag.createMany({
                data: [
                    {
                        userId: context.userId,
                        name: 'architecture',
                        color: '#3B82F6',
                        sortOrder: 0,
                    },
                    {
                        userId: context.userId,
                        name: 'backend',
                        color: '#10B981',
                        sortOrder: 1,
                    },
                    {
                        userId: context.userId,
                        name: 'frontend',
                        color: '#F59E0B',
                        sortOrder: 2,
                    },
                    {
                        userId: context.userId,
                        name: 'design',
                        color: '#EF4444',
                        sortOrder: 3,
                    },
                ],
            });
        });
    }
}
async function ensureUserBaselineOnce(context) {
    if (baselineReadyUsers.has(context.userId)) {
        return;
    }
    const existing = baselineInFlight.get(context.userId);
    if (existing) {
        await existing;
        return;
    }
    const pending = ensureUserBaseline(context)
        .then(() => {
        baselineReadyUsers.add(context.userId);
    })
        .finally(() => {
        baselineInFlight.delete(context.userId);
    });
    baselineInFlight.set(context.userId, pending);
    await pending;
}
async function provisionUser(input) {
    const nextUser = await client_1.prisma.user.create({
        data: {
            id: input.id,
            displayName: input.displayName,
            email: input.email ?? null,
            status: 'active',
        },
    });
    await (0, user_context_1.runWithUserContext)({
        userId: nextUser.id,
        source: nextUser.id === (0, user_context_1.getDefaultUserId)() ? 'default' : 'header',
    }, async () => {
        await client_1.prisma.userSetting.upsert({
            where: {
                userId: nextUser.id,
            },
            update: {
                profile_json: {
                    bio: input.bio ?? '',
                },
            },
            create: {
                userId: nextUser.id,
                theme: 'light',
                profile_json: {
                    bio: input.bio ?? '',
                },
                notification_json: {},
                agentPreferencesJson: {},
            },
        });
        await ensureUserBaselineOnce({
            userId: nextUser.id,
            source: nextUser.id === (0, user_context_1.getDefaultUserId)() ? 'default' : 'header',
        });
    });
    return nextUser;
}
async function authenticateRequest(request, _reply, options) {
    const userContext = (0, user_context_1.resolveRequestUserContext)(request);
    ensureValidUserContext(userContext);
    await ensureUserRecordExists(userContext);
    if (options?.ensureBaseline !== false) {
        await ensureUserBaselineOnce(userContext);
    }
}
function runAuthenticatedRequest(request, callback) {
    const userContext = (0, user_context_1.resolveRequestUserContext)(request);
    return (0, user_context_1.runWithUserContext)(userContext, callback);
}
