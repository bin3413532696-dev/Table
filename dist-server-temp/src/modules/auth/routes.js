"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const zod_1 = require("zod");
const client_1 = require("../../db/client");
const auth_1 = require("../../shared/auth");
const pin_1 = require("../../shared/pin");
const session_1 = require("../../shared/session");
const user_context_1 = require("../../shared/user-context");
const createUserSchema = zod_1.z.object({
    id: zod_1.z.string().uuid().optional(),
    displayName: zod_1.z.string().trim().min(1).max(50),
    email: zod_1.z.union([zod_1.z.string().trim().email(), zod_1.z.literal(''), zod_1.z.null()]).optional(),
    bio: zod_1.z.string().max(200).optional(),
});
const updateMeSchema = zod_1.z.object({
    displayName: zod_1.z.string().trim().min(1).max(50).optional(),
    email: zod_1.z.union([zod_1.z.string().trim().email(), zod_1.z.literal(''), zod_1.z.null()]).optional(),
    bio: zod_1.z.string().max(200).optional(),
}).refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
});
const switchSessionSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
});
function extractBio(profileJson) {
    if (!profileJson || typeof profileJson !== 'object' || Array.isArray(profileJson)) {
        return '';
    }
    const bio = profileJson.bio;
    return typeof bio === 'string' ? bio : '';
}
function toAuthUser(user) {
    return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        status: user.status,
        bio: extractBio(user.settings?.profile_json),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
    };
}
async function authRoutes(app) {
    app.get('/me', async () => {
        const context = (0, user_context_1.getCurrentUserContext)();
        const user = await client_1.prisma.user.findUniqueOrThrow({
            where: {
                id: context.userId,
            },
            include: {
                settings: {
                    select: {
                        profile_json: true,
                    },
                },
            },
        });
        return {
            data: {
                user: toAuthUser(user),
                auth: {
                    userIdHeader: user_context_1.USER_ID_HEADER,
                    source: context.source,
                    isDefaultUser: context.userId === (0, user_context_1.getDefaultUserId)(),
                    devSessionCookie: user_context_1.DEV_SESSION_COOKIE,
                },
            },
        };
    });
    app.get('/users', async () => {
        const defaultUserId = (0, user_context_1.getCurrentUserContext)().userId;
        const users = await client_1.prisma.user.findMany({
            where: {
                status: 'active',
            },
            include: {
                settings: {
                    select: {
                        profile_json: true,
                    },
                },
            },
            orderBy: [
                { updatedAt: 'desc' },
                { createdAt: 'desc' },
            ],
        });
        return {
            data: {
                items: users.map((user) => ({
                    ...toAuthUser(user),
                    isCurrentUser: user.id === defaultUserId,
                })),
                total: users.length,
            },
        };
    });
    app.post('/users', async (request, reply) => {
        const payload = createUserSchema.parse(request.body);
        const created = await (0, auth_1.provisionUser)({
            id: payload.id,
            displayName: payload.displayName,
            email: payload.email === '' ? null : payload.email,
            bio: payload.bio,
        });
        const user = await client_1.prisma.user.findUniqueOrThrow({
            where: {
                id: created.id,
            },
            include: {
                settings: {
                    select: {
                        profile_json: true,
                    },
                },
            },
        });
        return reply.code(201).send({
            data: {
                user: toAuthUser(user),
            },
        });
    });
    app.patch('/me', async (request) => {
        const context = (0, user_context_1.getCurrentUserContext)();
        const payload = updateMeSchema.parse(request.body);
        const user = await client_1.prisma.user.findUniqueOrThrow({
            where: {
                id: context.userId,
            },
            include: {
                settings: true,
            },
        });
        const nextEmail = payload.email === '' ? null : payload.email;
        const nextProfile = {
            bio: payload.bio !== undefined ? payload.bio : extractBio(user.settings?.profile_json),
        };
        const updated = await client_1.prisma.$transaction(async (tx) => {
            const nextUser = await tx.user.update({
                where: {
                    id: context.userId,
                },
                data: {
                    displayName: payload.displayName ?? user.displayName,
                    email: payload.email !== undefined ? nextEmail : user.email,
                },
            });
            await tx.userSetting.upsert({
                where: {
                    userId: context.userId,
                },
                update: {
                    profile_json: nextProfile,
                },
                create: {
                    userId: context.userId,
                    theme: 'light',
                    profile_json: nextProfile,
                    notification_json: {},
                    agentPreferencesJson: {},
                },
            });
            return tx.user.findUniqueOrThrow({
                where: {
                    id: nextUser.id,
                },
                include: {
                    settings: {
                        select: {
                            profile_json: true,
                        },
                    },
                },
            });
        });
        return {
            data: {
                user: toAuthUser(updated),
                auth: {
                    userIdHeader: user_context_1.USER_ID_HEADER,
                    source: context.source,
                    isDefaultUser: context.userId === (0, user_context_1.getDefaultUserId)(),
                    devSessionCookie: user_context_1.DEV_SESSION_COOKIE,
                },
            },
        };
    });
    app.post('/session', async (request, reply) => {
        const payload = switchSessionSchema.parse(request.body);
        const user = await client_1.prisma.user.findFirst({
            where: {
                id: payload.userId,
                status: 'active',
            },
            include: {
                settings: {
                    select: {
                        profile_json: true,
                    },
                },
            },
        });
        if (!user) {
            return reply.code(404).send({
                message: 'User not found or inactive',
            });
        }
        const token = (0, session_1.signSessionToken)(payload.userId, 86400);
        const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        reply.header('Set-Cookie', `${user_context_1.DEV_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`);
        return {
            data: {
                user: toAuthUser(user),
                auth: {
                    userIdHeader: user_context_1.USER_ID_HEADER,
                    source: 'signed_session',
                    isDefaultUser: payload.userId === (0, user_context_1.getDefaultUserId)(),
                    devSessionCookie: user_context_1.DEV_SESSION_COOKIE,
                },
            },
        };
    });
    app.delete('/session', async (_request, reply) => {
        const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        reply.header('Set-Cookie', `${user_context_1.DEV_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`);
        const defaultUser = await client_1.prisma.user.findUniqueOrThrow({
            where: {
                id: (0, user_context_1.getDefaultUserId)(),
            },
            include: {
                settings: {
                    select: {
                        profile_json: true,
                    },
                },
            },
        });
        return {
            data: {
                user: toAuthUser(defaultUser),
                auth: {
                    userIdHeader: user_context_1.USER_ID_HEADER,
                    source: 'default',
                    isDefaultUser: true,
                    devSessionCookie: user_context_1.DEV_SESSION_COOKIE,
                },
            },
        };
    });
    // PIN 管理
    app.get('/pin', async (request, reply) => {
        const context = (0, user_context_1.getCurrentUserContext)();
        const settings = await client_1.prisma.userSetting.findUnique({
            where: { userId: context.userId },
            select: { securityPinHash: true },
        });
        // 确保 CSRF Token Cookie 存在（前端需要读取它）
        if (!(0, auth_1.getCsrfTokenFromRequest)(request)) {
            const csrfToken = (0, auth_1.generateCsrfToken)();
            const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
            reply.header('Set-Cookie', `${auth_1.CSRF_COOKIE_NAME}=${csrfToken}; Path=/; SameSite=Lax${secureFlag}`);
        }
        return { enabled: Boolean(settings?.securityPinHash) };
    });
    const pinSchema = zod_1.z.object({
        pin: zod_1.z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
    });
    const verifyPinSchema = zod_1.z.object({
        pin: zod_1.z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
    });
    app.post('/pin/verify', {
        config: {
            rateLimit: {
                max: 5,
                timeWindow: '5 minutes',
            },
        },
    }, async (request, reply) => {
        const context = (0, user_context_1.getCurrentUserContext)();
        const payload = verifyPinSchema.parse(request.body);
        const settings = await client_1.prisma.userSetting.findUnique({
            where: { userId: context.userId },
            select: { securityPinHash: true },
        });
        if (!settings?.securityPinHash) {
            return reply.code(404).send({ error: 'NOT_FOUND', message: 'PIN not set' });
        }
        const isValid = (0, pin_1.verifyPin)(payload.pin, settings.securityPinHash);
        if (isValid) {
            const token = (0, session_1.signSessionToken)(context.userId, 86400);
            const csrfToken = (0, auth_1.generateCsrfToken)();
            const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
            // 设置 Session Cookie（HttpOnly）
            reply.header('Set-Cookie', `${user_context_1.DEV_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`);
            // 设置 CSRF Token Cookie（非 HttpOnly，前端可读取）
            reply.header('Set-Cookie', `${auth_1.CSRF_COOKIE_NAME}=${csrfToken}; Path=/; SameSite=Lax${secureFlag}`);
        }
        return { valid: isValid };
    });
    app.patch('/pin', async (request) => {
        const context = (0, user_context_1.getCurrentUserContext)();
        const payload = pinSchema.parse(request.body);
        const hashed = (0, pin_1.hashPin)(payload.pin);
        await client_1.prisma.userSetting.upsert({
            where: { userId: context.userId },
            update: { securityPinHash: hashed },
            create: {
                userId: context.userId,
                theme: 'light',
                profile_json: {},
                notification_json: {},
                agentPreferencesJson: {},
                securityPinHash: hashed,
            },
        });
        return { success: true };
    });
    app.delete('/pin', async () => {
        const context = (0, user_context_1.getCurrentUserContext)();
        await client_1.prisma.userSetting.updateMany({
            where: { userId: context.userId },
            data: { securityPinHash: null },
        });
        return { success: true };
    });
}
