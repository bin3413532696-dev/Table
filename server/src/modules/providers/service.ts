import { prisma } from '../../db/client';
import {
  decryptProviderSecret,
  encryptProviderSecret,
  hasProviderSecret,
  maskProviderSecret,
} from '../../shared/crypto';
import { getCurrentUserId } from '../../shared/user-context';
import type { CreateProviderInput, UpdateProviderInput } from './schema';

export type ProviderDto = {
  id: string;
  name: string;
  apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
  baseUrl: string;
  apiKey: string;
  model?: string;
  embeddingModel?: string;
  rerankerModel?: string;
  headers: Record<string, string>;
  isActive: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string;
  source: 'bootstrap' | 'manual';
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type AgentRuntimeProvider = {
  id: string;
  name: string;
  apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
  baseUrl: string;
  apiKey: string;
  model?: string;
  headers?: Record<string, string>;
};

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function toProviderDto(provider: {
  id: string;
  name: string;
  apiFormat: string;
  baseUrl: string;
  apiKeyEncrypted: string | null;
  model: string | null;
  embeddingModel?: string | null;
  rerankerModel?: string | null;
  headersJson: unknown;
  isActive: boolean;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}, options?: { includeSecret?: boolean }): ProviderDto {
  const apiKey = options?.includeSecret ? decryptProviderSecret(provider.apiKeyEncrypted) : '';
  return {
    id: provider.id,
    name: provider.name,
    apiFormat: provider.apiFormat as ProviderDto['apiFormat'],
    baseUrl: provider.baseUrl,
    apiKey,
    model: provider.model || undefined,
    embeddingModel: provider.embeddingModel || undefined,
    rerankerModel: provider.rerankerModel || undefined,
    headers: toStringRecord(provider.headersJson),
    isActive: provider.isActive,
    hasApiKey: hasProviderSecret(provider.apiKeyEncrypted),
    apiKeyPreview: maskProviderSecret(provider.apiKeyEncrypted),
    source: provider.source as 'bootstrap' | 'manual',
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
    version: provider.version,
  };
}

function normalizeOptionalString(value?: string) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export async function listProvidersForCurrentUser() {
  const providers = await prisma.apiProvider.findMany({
    where: {
      userId: getCurrentUserId(),
    },
    orderBy: [
      { isActive: 'desc' },
      { updatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  return providers.map((provider) => toProviderDto(provider));
}

export async function getActiveProviderForCurrentUser() {
  const provider = await prisma.apiProvider.findFirst({
    where: {
      userId: getCurrentUserId(),
      isActive: true,
    },
    orderBy: [
      { updatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  return provider ? toProviderDto(provider, { includeSecret: true }) : null;
}

export async function getRequiredActiveProviderForCurrentUser(): Promise<AgentRuntimeProvider> {
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

export async function createProviderForCurrentUser(input: CreateProviderInput) {
  const userId = getCurrentUserId();
  const activeProviderCount = await prisma.apiProvider.count({
    where: {
      userId,
      isActive: true,
    },
  });
  const shouldActivate = input.isActive || activeProviderCount === 0;

  const provider = await prisma.$transaction(async (tx) => {
    if (shouldActivate) {
      await tx.apiProvider.updateMany({
        where: {
          userId,
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
          ? encryptProviderSecret(input.apiKey)
          : null,
        model: normalizeOptionalString(input.model),
        embeddingModel: input.embeddingModel ? normalizeOptionalString(input.embeddingModel) : null,
        rerankerModel: input.rerankerModel ? normalizeOptionalString(input.rerankerModel) : null,
        headersJson: input.headers ?? {},
        isActive: shouldActivate,
        source: input.source ?? 'manual',
      },
    });
  });

  return toProviderDto(provider);
}

export async function updateProviderForCurrentUser(id: string, input: UpdateProviderInput) {
  const userId = getCurrentUserId();
  const existing = await prisma.apiProvider.findFirst({
    where: {
      id,
      userId,
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
  const provider = await prisma.$transaction(async (tx) => {
    if (shouldActivate) {
      await tx.apiProvider.updateMany({
        where: {
          userId,
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
          ? { apiKeyEncrypted: nextApiKey ? encryptProviderSecret(nextApiKey) : existing.apiKeyEncrypted }
          : {}),
        ...(input.model !== undefined ? { model: normalizeOptionalString(input.model) } : {}),
        ...(input.embeddingModel !== undefined ? { embeddingModel: normalizeOptionalString(input.embeddingModel) } : {}),
        ...(input.rerankerModel !== undefined ? { rerankerModel: normalizeOptionalString(input.rerankerModel) } : {}),
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

export async function activateProviderForCurrentUser(id: string) {
  const userId = getCurrentUserId();
  const existing = await prisma.apiProvider.findFirst({
    where: {
      id,
      userId,
    },
  });

  if (!existing) {
    return null;
  }

  const provider = await prisma.$transaction(async (tx) => {
    await tx.apiProvider.updateMany({
      where: {
        userId,
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

export async function deleteProviderForCurrentUser(id: string) {
  const userId = getCurrentUserId();
  const existing = await prisma.apiProvider.findFirst({
    where: {
      id,
      userId,
    },
  });

  if (!existing) {
    return null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.apiProvider.delete({
      where: {
        id,
      },
    });

    if (!existing.isActive) {
      return;
    }

    const fallback = await tx.apiProvider.findFirst({
      where: {
        userId,
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
