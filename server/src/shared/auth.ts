import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client';
import { createProviderForCurrentUser, listProvidersForCurrentUser, updateProviderForCurrentUser } from '../modules/providers/service';
import {
  type ServerUserContext,
  getDefaultUserId,
  resolveRequestUserContext,
  runWithUserContext,
  USER_ID_HEADER,
} from './user-context';
import { loadServerConfig } from './config';

const userIdSchema = z.string().uuid();
// Intentionally never cleaned: entries persist for server lifetime to avoid redundant baseline checks.
const baselineReadyUsers = new Set<string>();
const baselineInFlight = new Map<string, Promise<void>>();

// CSRF Token 配置
export const CSRF_COOKIE_NAME = 'table_dev_csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * 生成 CSRF Token（32 字节随机）
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 验证 CSRF Token：请求头中的 Token 必须匹配 Cookie 中的
 */
export function validateCsrfToken(request: FastifyRequest): boolean {
  // 从 Cookie 头中解析 CSRF Token
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return false;
  }

  const cookies = cookieHeader.split(';');
  let cookieToken: string | null = null;
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME && value) {
      cookieToken = value;
      break;
    }
  }

  const headerToken = request.headers[CSRF_HEADER_NAME];
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
export function getCsrfTokenFromRequest(request: FastifyRequest): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME && value) {
      return value;
    }
  }
  return null;
}

function computeProviderConfigHash(baseUrl: string, apiKey: string, model: string): string {
  // 先对 apiKey 单独哈希，防止通过配置哈希反推 apiKey
  const hashedApiKey = createHash('sha256').update(apiKey).digest('hex');
  return createHash('sha256').update(`${baseUrl}|${hashedApiKey}|${model}`).digest('hex').slice(0, 16);
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: 'UNAUTHORIZED' | 'FORBIDDEN'
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

function ensureValidUserContext(context: ServerUserContext) {
  if (context.source === 'missing') {
    const config = loadServerConfig();
    if (!config.ALLOW_DEFAULT_USER_FALLBACK) {
      throw new AuthError(`Missing ${USER_ID_HEADER} header`, 401, 'UNAUTHORIZED');
    }
    return;
  }

  const parsed = userIdSchema.safeParse(context.userId);
  if (!parsed.success) {
    throw new AuthError(`Invalid ${USER_ID_HEADER} header`, 401, 'UNAUTHORIZED');
  }
}

async function ensureUserRecordExists(context: ServerUserContext) {
  const existing = await prisma.user.findUnique({
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

  if (context.userId !== getDefaultUserId()) {
    throw new AuthError('User not found. Please create the user first.', 401, 'UNAUTHORIZED');
  }

  const fallbackName = context.userId === getDefaultUserId()
    ? 'Default Local User'
    : `User ${context.userId.slice(0, 8)}`;

  return prisma.user.create({
    data: {
      id: context.userId,
      displayName: fallbackName,
      status: 'active',
    },
  });
}

async function ensureUserBaseline(context: ServerUserContext) {
  const config = loadServerConfig();
  const currentEnvHash = computeProviderConfigHash(
    config.DEFAULT_PROVIDER_BASE_URL,
    config.DEFAULT_PROVIDER_API_KEY,
    config.DEFAULT_PROVIDER_MODEL
  );

  const existingSettings = await prisma.userSetting.findUnique({
    where: {
      userId: context.userId,
    },
  });

  if (!existingSettings) {
    await prisma.userSetting.create({
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

  const existingProviders = await listProvidersForCurrentUser();
  const bootstrapProvider = existingProviders.find(p => p.source === 'bootstrap');
  // 兼容旧数据：如果没有 bootstrap provider 但有一个 provider 且用户没有手动创建过，使用它
  const legacyProvider = !bootstrapProvider && existingProviders.length === 1 ? existingProviders[0] : null;
  // 如果没有任何 provider，需要创建一个（无论 settings 是否已存在）
  const needsNewProvider = existingProviders.length === 0;
  const shouldBootstrapWorkspace =
    !existingSettings &&
    existingProviders.length === 0;

  // 检测 .env 配置变更，自动同步 bootstrap Provider 或 legacy Provider
  const providerToSync = bootstrapProvider || legacyProvider;
  if (providerToSync && existingSettings) {
    const storedHash = existingSettings.providerConfigHash;
    if (storedHash !== currentEnvHash && config.DEFAULT_PROVIDER_BASE_URL.trim()) {
      // 配置变更，需要同步更新 Provider
      await updateProviderForCurrentUser(providerToSync.id, {
        name: config.DEFAULT_PROVIDER_NAME,
        apiFormat: config.DEFAULT_PROVIDER_FORMAT,
        baseUrl: config.DEFAULT_PROVIDER_BASE_URL,
        apiKey: config.DEFAULT_PROVIDER_API_KEY,
        model: config.DEFAULT_PROVIDER_MODEL,
      });

      // 更新哈希
      await prisma.userSetting.update({
        where: { userId: context.userId },
        data: { providerConfigHash: currentEnvHash },
      });
    }
  } else if (shouldBootstrapWorkspace) {
    const config = loadServerConfig();
    if (config.DEFAULT_PROVIDER_BASE_URL.trim()) {
      await createProviderForCurrentUser({
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
    const config = loadServerConfig();
    if (config.DEFAULT_PROVIDER_BASE_URL.trim()) {
      await createProviderForCurrentUser({
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
        await prisma.userSetting.update({
          where: { userId: context.userId },
          data: { providerConfigHash: currentEnvHash },
        });
      }
    }
  }

  if (shouldBootstrapWorkspace) {
    // 更新 bootstrap Provider 的哈希（如果刚创建）
    await prisma.userSetting.update({
      where: { userId: context.userId },
      data: { providerConfigHash: currentEnvHash },
    });

    const [taskCount, financeCount] = await Promise.all([
      prisma.task.count({
        where: {
          userId: context.userId,
        },
      }),
      prisma.financeRecord.count({
        where: {
          userId: context.userId,
        },
      }),
    ]);

    if (taskCount !== 0 || financeCount !== 0) {
      return;
    }

    await prisma.$transaction(async (tx) => {
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

async function ensureUserBaselineOnce(context: ServerUserContext) {
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

export async function provisionUser(input: {
  id?: string;
  displayName: string;
  email?: string | null;
  bio?: string;
}) {
  const nextUser = await prisma.user.create({
    data: {
      id: input.id,
      displayName: input.displayName,
      email: input.email ?? null,
      status: 'active',
    },
  });

  await runWithUserContext(
    {
      userId: nextUser.id,
      source: nextUser.id === getDefaultUserId() ? 'default' : 'header',
    },
    async () => {
      await prisma.userSetting.upsert({
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
        source: nextUser.id === getDefaultUserId() ? 'default' : 'header',
      });
    }
  );

  return nextUser;
}

export async function authenticateRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
  options?: { ensureBaseline?: boolean }
) {
  const userContext = resolveRequestUserContext(request);
  ensureValidUserContext(userContext);
  await ensureUserRecordExists(userContext);

  if (options?.ensureBaseline !== false) {
    await ensureUserBaselineOnce(userContext);
  }
}

export function runAuthenticatedRequest<T>(request: FastifyRequest, callback: () => T) {
  const userContext = resolveRequestUserContext(request);
  return runWithUserContext(userContext, callback);
}