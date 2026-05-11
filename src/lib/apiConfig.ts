import { fetchWithAuth } from './auth';

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

async function parseErrorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { message?: string };
    return payload.message || fallback;
  } catch {
    return fallback;
  }
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
  const response = await fetchWithAuth('/api/providers');
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Failed to load providers: HTTP ${response.status}`));
  }

  const payload = await response.json() as {
    data: {
      items: ApiProvider[];
    };
  };

  setProviderCache(payload.data.items || []);
  return getApiConfigs();
}

export async function saveApiConfigs(configs: ApiProvider[]): Promise<void> {
  const currentById = new Map(providerCache.map((provider) => [provider.id, provider] as const));
  const nextIds = new Set(configs.map((provider) => provider.id));

  for (const provider of configs) {
    const existing = currentById.get(provider.id);
    if (!existing) {
      const createResponse = await fetchWithAuth('/api/providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: provider.id,
          name: provider.name,
          apiFormat: provider.apiFormat,
          baseUrl: provider.baseUrl,
          ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
          model: provider.model || '',
          headers: provider.headers || {},
          isActive: provider.isActive,
        }),
      });

      if (!createResponse.ok) {
        throw new Error(await parseErrorMessage(createResponse, `Failed to create provider: HTTP ${createResponse.status}`));
      }
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
      JSON.stringify(existing.headers || {}) !== JSON.stringify(provider.headers || {}) ||
      existing.isActive !== provider.isActive;

    if (!changed) {
      continue;
    }

    const updateResponse = await fetchWithAuth(`/api/providers/${provider.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
        model: provider.model || '',
        headers: provider.headers || {},
        isActive: provider.isActive,
      }),
    });

    if (!updateResponse.ok) {
      throw new Error(await parseErrorMessage(updateResponse, `Failed to update provider: HTTP ${updateResponse.status}`));
    }
  }

  for (const existing of providerCache) {
    if (nextIds.has(existing.id)) {
      continue;
    }

    const deleteResponse = await fetchWithAuth(`/api/providers/${existing.id}`, {
      method: 'DELETE',
    });
    if (!deleteResponse.ok) {
      throw new Error(await parseErrorMessage(deleteResponse, `Failed to delete provider: HTTP ${deleteResponse.status}`));
    }
  }

  await refreshApiConfigs();
}

export async function activateApiConfig(id: string): Promise<ApiProvider[]> {
  const response = await fetchWithAuth(`/api/providers/${id}/activate`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Failed to activate provider: HTTP ${response.status}`));
  }

  return refreshApiConfigs();
}

export async function deleteApiConfig(id: string): Promise<ApiProvider[]> {
  const response = await fetchWithAuth(`/api/providers/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Failed to delete provider: HTTP ${response.status}`));
  }

  return refreshApiConfigs();
}

export function getActiveApiConfig(): ApiProvider | null {
  return providerCache.find((config) => config.isActive) || null;
}

export function getPreferredAgentModel(): string {
  return getActiveApiConfig()?.model || 'llama3.2';
}
