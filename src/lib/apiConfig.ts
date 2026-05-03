export interface ApiProvider {
  id: string;
  name: string;
  isActive: boolean;
  apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
  baseUrl: string;
  apiKey: string;
  model?: string;
  headers?: Record<string, string>;
}

export const API_CONFIG_KEY = 'agent_api_configs';
export const API_CONFIG_CHANGED_EVENT = 'agent-api-config-changed';

const BOOTSTRAP_FLAG_KEY = 'agent_api_bootstrap_glm5_done';
const BOOTSTRAP_PROVIDER_ID = 'bootstrap-glm-5-provider';

const BOOTSTRAP_PROVIDER: ApiProvider = {
  id: BOOTSTRAP_PROVIDER_ID,
  name: 'GLM-5 Provider',
  isActive: true,
  apiFormat: 'openai',
  baseUrl: 'https://zyapi.tuluo.top:8888/v1',
  apiKey: 'pk_CghGChEfm8-3YfhXzP84VF5p69qry3P5LrUMeRxGuoI',
  model: 'glm-5',
  headers: {},
};

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getApiConfigs(): ApiProvider[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(API_CONFIG_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveApiConfigs(configs: ApiProvider[]): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(API_CONFIG_KEY, JSON.stringify(configs));
  notifyApiConfigChanged();
}

export function getActiveApiConfig(): ApiProvider | null {
  const configs = getApiConfigs();
  return configs.find((config) => config.isActive) || null;
}

export function getPreferredAgentModel(): string {
  return getActiveApiConfig()?.model || 'llama3.2';
}

export function notifyApiConfigChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(API_CONFIG_CHANGED_EVENT));
}

export function ensureBootstrappedApiConfig(): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    if (window.localStorage.getItem(BOOTSTRAP_FLAG_KEY) === 'true') {
      return;
    }

    const configs = getApiConfigs();
    const existingIndex = configs.findIndex((config) => config.id === BOOTSTRAP_PROVIDER_ID);
    const nextConfigs = configs.map((config) => ({ ...config, isActive: false }));

    if (existingIndex >= 0) {
      nextConfigs[existingIndex] = {
        ...nextConfigs[existingIndex],
        ...BOOTSTRAP_PROVIDER,
        isActive: true,
      };
    } else {
      nextConfigs.push({ ...BOOTSTRAP_PROVIDER });
    }

    saveApiConfigs(nextConfigs);
    window.localStorage.setItem(BOOTSTRAP_FLAG_KEY, 'true');
  } catch {
    // Ignore bootstrap failures and let the app continue.
  }
}
