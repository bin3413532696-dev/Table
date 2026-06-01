import { requestApi } from './api/client';

export interface ApiProvider {
  id: string;
  name: string;
  isActive: boolean;
  apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
  baseUrl: string;
  apiKey: string;
  hasApiKey?: boolean;
  apiKeyPreview?: string;
  model?: string;
  embeddingModel?: string;
  rerankerModel?: string;
  headers?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
}

export const API_CONFIG_CHANGED_EVENT = 'agent-api-config-changed';

let providerCache: ApiProvider[] = [];
let providersLoaded = false;

function cloneProviders(providers: ApiProvider[]): ApiProvider[] {
  return providers.map((provider) => ({
    ...provider,
    headers: provider.headers ? { ...provider.headers } : undefined,
  }));
}

/**
 * 清空 Provider 缓存（用户会话变更时调用）
 */
export function clearProviderCache(): void {
  providerCache = [];
  providersLoaded = false;
}

export function notifyApiConfigChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(API_CONFIG_CHANGED_EVENT));
}

function setProviderCache(providers: ApiProvider[]) {
  providerCache = cloneProviders(providers);
  providersLoaded = true;
  notifyApiConfigChanged();
}

export async function ensureBootstrappedApiConfig(): Promise<void> {
  if (providersLoaded) {
    return;
  }

  await refreshApiConfigs();
}

export function getApiConfigs(): ApiProvider[] {
  return cloneProviders(providerCache);
}

export async function refreshApiConfigs(): Promise<ApiProvider[]> {
  const payload = await requestApi<{
    data: {
      items: ApiProvider[];
    };
  }>('/api/providers');

  setProviderCache(payload.data.items || []);
  return getApiConfigs();
}

export async function saveApiConfigs(configs: ApiProvider[]): Promise<void> {
  const currentById = new Map(providerCache.map((provider) => [provider.id, provider] as const));
  const nextIds = new Set(configs.map((provider) => provider.id));

  for (const provider of configs) {
    const existing = currentById.get(provider.id);
    if (!existing) {
      await requestApi('/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          id: provider.id,
          name: provider.name,
          apiFormat: provider.apiFormat,
          baseUrl: provider.baseUrl,
          ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
          model: provider.model || '',
          embeddingModel: provider.embeddingModel || '',
          rerankerModel: provider.rerankerModel || '',
          headers: provider.headers || {},
          isActive: provider.isActive,
        }),
      });
      continue;
    }

    const apiKeyChanged = provider.apiKey
      ? (existing.apiKey || '') !== provider.apiKey
      : false;
    const changed =
      existing.name !== provider.name ||
      existing.apiFormat !== provider.apiFormat ||
      existing.baseUrl !== provider.baseUrl ||
      apiKeyChanged ||
      (existing.model || '') !== (provider.model || '') ||
      (existing.embeddingModel || '') !== (provider.embeddingModel || '') ||
      (existing.rerankerModel || '') !== (provider.rerankerModel || '') ||
      JSON.stringify(existing.headers || {}) !== JSON.stringify(provider.headers || {}) ||
      existing.isActive !== provider.isActive;

    if (!changed) {
      continue;
    }

    await requestApi(`/api/providers/${provider.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
        model: provider.model || '',
        embeddingModel: provider.embeddingModel || '',
        rerankerModel: provider.rerankerModel || '',
        headers: provider.headers || {},
        isActive: provider.isActive,
      }),
    });
  }

  for (const existing of providerCache) {
    if (nextIds.has(existing.id)) {
      continue;
    }

    await requestApi(`/api/providers/${existing.id}`, {
      method: 'DELETE',
    });
  }

  await refreshApiConfigs();
}

export async function activateApiConfig(id: string): Promise<ApiProvider[]> {
  await requestApi(`/api/providers/${id}/activate`, {
    method: 'POST',
  });

  return refreshApiConfigs();
}

export async function deleteApiConfig(id: string): Promise<ApiProvider[]> {
  await requestApi(`/api/providers/${id}`, {
    method: 'DELETE',
  });

  return refreshApiConfigs();
}

export function getActiveApiConfig(): ApiProvider | null {
  return providerCache.find((config) => config.isActive) || null;
}

export function getPreferredAgentModel(): string {
  return getActiveApiConfig()?.model || 'llama3.2';
}
