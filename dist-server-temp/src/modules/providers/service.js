"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProvidersForCurrentUser = listProvidersForCurrentUser;
exports.getActiveProviderForCurrentUser = getActiveProviderForCurrentUser;
exports.getRequiredActiveProviderForCurrentUser = getRequiredActiveProviderForCurrentUser;
exports.createProviderForCurrentUser = createProviderForCurrentUser;
exports.updateProviderForCurrentUser = updateProviderForCurrentUser;
exports.activateProviderForCurrentUser = activateProviderForCurrentUser;
exports.deleteProviderForCurrentUser = deleteProviderForCurrentUser;
const client_1 = require("../../db/client");
const crypto_1 = require("../../shared/crypto");
const user_context_1 = require("../../shared/user-context");
function toStringRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === 'string'));
}
function toProviderDto(provider, options) {
    const apiKey = options?.includeSecret ? (0, crypto_1.decryptProviderSecret)(provider.apiKeyEncrypted) : '';
    return {
        id: provider.id,
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        apiKey,
        model: provider.model || undefined,
        headers: toStringRecord(provider.headersJson),
        isActive: provider.isActive,
        hasApiKey: (0, crypto_1.hasProviderSecret)(provider.apiKeyEncrypted),
        apiKeyPreview: (0, crypto_1.maskProviderSecret)(provider.apiKeyEncrypted),
        source: provider.source,
        createdAt: provider.createdAt.toISOString(),
        updatedAt: provider.updatedAt.toISOString(),
        version: provider.version,
    };
}
function normalizeOptionalString(value) {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
}
async function listProvidersForCurrentUser() {
    const providers = await client_1.prisma.apiProvider.findMany({
        where: {
            userId: (0, user_context_1.getCurrentUserId)(),
            deletedAt: null,
        },
        orderBy: [
            { isActive: 'desc' },
            { updatedAt: 'desc' },
            { createdAt: 'desc' },
        ],
    });
    return providers.map((provider) => toProviderDto(provider));
}
async function getActiveProviderForCurrentUser() {
    const provider = await client_1.prisma.apiProvider.findFirst({
        where: {
            userId: (0, user_context_1.getCurrentUserId)(),
            deletedAt: null,
            isActive: true,
        },
        orderBy: [
            { updatedAt: 'desc' },
            { createdAt: 'desc' },
        ],
    });
    return provider ? toProviderDto(provider, { includeSecret: true }) : null;
}
async function getRequiredActiveProviderForCurrentUser() {
    const provider = await getActiveProviderForCurrentUser();
    if (!provider) {
        throw new Error('当前用户没有已激活的 Provider 配置。请先在设置页完成 Provider 配置。');
    }
    if (!provider.baseUrl.trim()) {
        throw new Error('当前激活的 Provider 缺少 baseUrl。');
    }
    return {
        id: provider.id,
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        headers: provider.headers,
    };
}
async function createProviderForCurrentUser(input) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const activeProviderCount = await client_1.prisma.apiProvider.count({
        where: {
            userId,
            deletedAt: null,
            isActive: true,
        },
    });
    const shouldActivate = input.isActive || activeProviderCount === 0;
    const provider = await client_1.prisma.$transaction(async (tx) => {
        if (shouldActivate) {
            await tx.apiProvider.updateMany({
                where: {
                    userId,
                    deletedAt: null,
                    isActive: true,
                },
                data: {
                    isActive: false,
                },
            });
        }
        return tx.apiProvider.create({
            data: {
                id: input.id,
                userId,
                name: input.name.trim(),
                apiFormat: input.apiFormat,
                baseUrl: input.baseUrl.trim(),
                apiKeyEncrypted: normalizeOptionalString(input.apiKey)
                    ? (0, crypto_1.encryptProviderSecret)(input.apiKey)
                    : null,
                model: normalizeOptionalString(input.model),
                headersJson: input.headers,
                isActive: shouldActivate,
                source: input.source ?? 'manual',
            },
        });
    });
    return toProviderDto(provider);
}
async function updateProviderForCurrentUser(id, input) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const existing = await client_1.prisma.apiProvider.findFirst({
        where: {
            id,
            userId,
            deletedAt: null,
        },
    });
    if (!existing) {
        return null;
    }
    if (input.version !== undefined && input.version !== existing.version) {
        throw Object.assign(new Error('Provider was modified by another request. Please refresh and try again.'), {
            statusCode: 409,
            code: 'VERSION_CONFLICT',
        });
    }
    const shouldActivate = input.isActive === true;
    const nextApiKey = input.apiKey !== undefined
        ? normalizeOptionalString(input.apiKey)
        : undefined;
    const provider = await client_1.prisma.$transaction(async (tx) => {
        if (shouldActivate) {
            await tx.apiProvider.updateMany({
                where: {
                    userId,
                    deletedAt: null,
                    isActive: true,
                    id: {
                        not: id,
                    },
                },
                data: {
                    isActive: false,
                },
            });
        }
        return tx.apiProvider.update({
            where: {
                id,
            },
            data: {
                ...(input.name !== undefined ? { name: input.name.trim() } : {}),
                ...(input.apiFormat !== undefined ? { apiFormat: input.apiFormat } : {}),
                ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl.trim() } : {}),
                ...(nextApiKey !== undefined
                    ? { apiKeyEncrypted: nextApiKey ? (0, crypto_1.encryptProviderSecret)(nextApiKey) : existing.apiKeyEncrypted }
                    : {}),
                ...(input.model !== undefined ? { model: normalizeOptionalString(input.model) } : {}),
                ...(input.headers !== undefined ? { headersJson: input.headers } : {}),
                ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
                version: {
                    increment: 1,
                },
            },
        });
    });
    return toProviderDto(provider);
}
async function activateProviderForCurrentUser(id) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const existing = await client_1.prisma.apiProvider.findFirst({
        where: {
            id,
            userId,
            deletedAt: null,
        },
    });
    if (!existing) {
        return null;
    }
    const provider = await client_1.prisma.$transaction(async (tx) => {
        await tx.apiProvider.updateMany({
            where: {
                userId,
                deletedAt: null,
                isActive: true,
            },
            data: {
                isActive: false,
            },
        });
        return tx.apiProvider.update({
            where: {
                id,
            },
            data: {
                isActive: true,
                version: {
                    increment: 1,
                },
            },
        });
    });
    return toProviderDto(provider);
}
async function deleteProviderForCurrentUser(id) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const existing = await client_1.prisma.apiProvider.findFirst({
        where: {
            id,
            userId,
            deletedAt: null,
        },
    });
    if (!existing) {
        return null;
    }
    await client_1.prisma.$transaction(async (tx) => {
        await tx.apiProvider.update({
            where: {
                id,
            },
            data: {
                deletedAt: new Date(),
                isActive: false,
                version: {
                    increment: 1,
                },
            },
        });
        if (!existing.isActive) {
            return;
        }
        const fallback = await tx.apiProvider.findFirst({
            where: {
                userId,
                deletedAt: null,
            },
            orderBy: [
                { updatedAt: 'desc' },
                { createdAt: 'desc' },
            ],
        });
        if (!fallback) {
            return;
        }
        await tx.apiProvider.update({
            where: {
                id: fallback.id,
            },
            data: {
                isActive: true,
                version: {
                    increment: 1,
                },
            },
        });
    });
    return {
        id,
        deleted: true,
    };
}
