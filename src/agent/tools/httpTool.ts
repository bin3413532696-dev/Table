import type { JSONSchema, Tool, ToolResult } from '../types';
import { ApiProvider, getApiConfigs, saveApiConfigs } from '../../lib/apiConfig';

type ApiConfig = ApiProvider;

function buildHeaders(config: ApiConfig, customHeaders?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(config.headers || {}),
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    ...(customHeaders || {}),
  };
}

function getEndpoint(config: ApiConfig): string {
  switch (config.apiFormat) {
    case 'openai':
    case 'custom':
      return '/chat/completions';
    case 'anthropic':
      return '/messages';
    case 'gemini':
      return `/models/${config.model || 'gemini-pro'}:generateContent`;
    default:
      return '/chat/completions';
  }
}

function serializeBody(body: Record<string, unknown>, contentType: string): string | undefined {
  if (!body) {
    return undefined;
  }

  switch (contentType) {
    case 'application/x-www-form-urlencoded':
      return new URLSearchParams(body as Record<string, string>).toString();
    case 'text/plain':
      return typeof body === 'string' ? body : JSON.stringify(body);
    default:
      return JSON.stringify(body);
  }
}

function formatRequestBody(config: ApiConfig, body: Record<string, unknown>): Record<string, unknown> {
  const modelToUse = (body.model as string) || config.model;
  const messages = (body.messages as { role: string; content: string }[]) || [];

  switch (config.apiFormat) {
    case 'anthropic':
      return {
        model: modelToUse,
        max_tokens: body.max_tokens || 4096,
        messages: messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
          })),
        system: messages.find((message) => message.role === 'system')?.content,
      };
    case 'gemini':
      return {
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: body.temperature || 0.7,
          maxOutputTokens: body.max_tokens || 4096,
        },
      };
    case 'openai':
    case 'custom':
    default:
      return {
        model: modelToUse,
        messages,
        temperature: body.temperature || 0.7,
        max_tokens: body.max_tokens || 4096,
        ...body,
      };
  }
}

function formatResponse(config: ApiConfig, responseBody: unknown): string | undefined {
  if (typeof responseBody !== 'object' || responseBody === null) {
    return undefined;
  }

  const body = responseBody as Record<string, unknown>;

  switch (config.apiFormat) {
    case 'anthropic': {
      const content = (body.content as { type: string; text: string }[]) || [];
      return content.find((item) => item.type === 'text')?.text;
    }
    case 'gemini': {
      const candidates = (body.candidates as { content: { parts: { text: string }[] } }[]) || [];
      const firstCandidate = candidates[0];
      return firstCandidate?.content?.parts?.map((part) => part.text).join('\n');
    }
    case 'openai':
    case 'custom':
    default: {
      const choices = (body.choices as { message: { content: string } }[]) || [];
      return choices[0]?.message?.content;
    }
  }
}

export const httpRequestTool: Tool = {
  name: 'http_request',
  description: '发送 HTTP 请求到第三方 API',
  parameters: {
    type: 'object',
    required: ['method'],
    properties: {
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP 方法', default: 'POST' },
      url: { type: 'string', description: '完整请求 URL（当不使用 apiConfigId 时必填）' },
      apiConfigId: { type: 'string', description: '预配置的 API 配置 ID（使用配置时优先）' },
      headers: { type: 'object', description: '自定义请求头（可选）' } as JSONSchema,
      body: { type: 'object', description: '请求体（POST/PUT/PATCH 时使用，可选）' } as JSONSchema,
      model: { type: 'string', description: 'AI 模型名称（覆盖配置中的模型）' },
      timeout: { type: 'number', description: '超时时间（毫秒）', default: 30000 },
    },
  },
  requiresConfirmation: true,
  category: 'mutation',
  execute: async (params): Promise<ToolResult> => {
    const method = (params.method as string) || 'POST';
    const url = params.url as string;
    const apiConfigId = params.apiConfigId as string;
    const customHeaders = params.headers as Record<string, string>;
    const body = params.body as Record<string, unknown>;
    const customModel = params.model as string;
    const timeout = (params.timeout as number) || 30000;

    try {
      let requestUrl = url;
      let contentType = 'application/json';
      let headers: Record<string, string> = { 'Content-Type': contentType, ...(customHeaders || {}) };
      let requestBody = body;
      let config: ApiConfig | undefined;

      if (apiConfigId) {
        config = getApiConfigs().find((item) => item.id === apiConfigId);
        if (!config) {
          return { success: false, error: `未找到 API 配置: ${apiConfigId}` };
        }

        requestUrl = new URL(getEndpoint(config), config.baseUrl).href;
        headers = buildHeaders(config, customHeaders);

        if (requestBody && typeof requestBody === 'object') {
          requestBody = formatRequestBody(config, {
            ...requestBody,
            ...(customModel ? { model: customModel } : {}),
          });
        }
      } else if (!url) {
        return { success: false, error: '请提供 url 或 apiConfigId' };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(requestUrl, {
        method,
        headers,
        body: method === 'POST' || method === 'PUT' || method === 'PATCH'
          ? serializeBody(requestBody || {}, contentType)
          : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      return {
        success: response.ok,
        data: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody,
          content: config ? formatResponse(config, responseBody) : undefined,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'HTTP 请求失败',
      };
    }
  },
};

export const manageApiConfigTool: Tool = {
  name: 'manage_api_config',
  description: '管理 API Provider 配置（添加、更新、删除、列表、激活）',
  parameters: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['list', 'add', 'update', 'delete', 'activate'], description: '操作类型' },
      id: { type: 'string', description: 'Provider ID' },
      name: { type: 'string', description: 'Provider 名称' },
      apiFormat: { type: 'string', enum: ['openai', 'anthropic', 'gemini', 'custom'], description: 'API 格式' },
      baseUrl: { type: 'string', description: 'API 基础 URL' },
      apiKey: { type: 'string', description: 'API 密钥' },
      model: { type: 'string', description: '模型名称' },
      headers: { type: 'object', description: '自定义请求头' } as JSONSchema,
    },
  },
  requiresConfirmation: true,
  category: 'system',
  execute: async (params): Promise<ToolResult> => {
    const action = params.action as string;
    const id = params.id as string;
    const name = params.name as string;
    const apiFormat = (params.apiFormat as ApiProvider['apiFormat']) || 'openai';
    const baseUrl = params.baseUrl as string;
    const apiKey = params.apiKey as string;
    const model = params.model as string;
    const headers = params.headers as Record<string, string>;

    try {
      let configs = getApiConfigs();

      switch (action) {
        case 'list':
          return {
            success: true,
            data: configs.map((config) => ({
              id: config.id,
              name: config.name,
              isActive: config.isActive,
              apiFormat: config.apiFormat,
              baseUrl: config.baseUrl,
              hasApiKey: !!config.apiKey,
              model: config.model,
            })),
          };
        case 'add': {
          if (!name || !baseUrl) {
            return { success: false, error: '缺少必需参数：name 和 baseUrl' };
          }

          const newConfig: ApiProvider = {
            id: crypto.randomUUID(),
            name,
            isActive: configs.length === 0,
            apiFormat,
            baseUrl,
            apiKey,
            model,
            headers,
          };

          configs.push(newConfig);
          saveApiConfigs(configs);
          return { success: true, data: { id: newConfig.id, name: newConfig.name, isActive: newConfig.isActive } };
        }
        case 'update': {
          if (!id) {
            return { success: false, error: '缺少必需参数：id' };
          }

          const updateIndex = configs.findIndex((config) => config.id === id);
          if (updateIndex === -1) {
            return { success: false, error: `未找到配置 ${id}` };
          }

          configs[updateIndex] = {
            ...configs[updateIndex],
            ...(name ? { name } : {}),
            ...(apiFormat ? { apiFormat } : {}),
            ...(baseUrl ? { baseUrl } : {}),
            ...(apiKey !== undefined ? { apiKey } : {}),
            ...(model !== undefined ? { model } : {}),
            ...(headers ? { headers } : {}),
          };

          saveApiConfigs(configs);
          return { success: true, data: { id, message: '配置更新成功' } };
        }
        case 'delete':
          if (!id) {
            return { success: false, error: '缺少必需参数：id' };
          }

          configs = configs.filter((config) => config.id !== id);
          saveApiConfigs(configs);
          return { success: true, data: { id, message: '配置删除成功' } };
        case 'activate':
          if (!id) {
            return { success: false, error: '缺少必需参数：id' };
          }

          if (!configs.some((config) => config.id === id)) {
            return { success: false, error: `未找到配置 ${id}` };
          }

          configs = configs.map((config) => ({ ...config, isActive: config.id === id }));
          saveApiConfigs(configs);
          return { success: true, data: { id, message: 'Provider 已激活' } };
        default:
          return { success: false, error: `未知操作: ${action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '操作失败',
      };
    }
  },
};

export const getWeatherTool: Tool = {
  name: 'get_weather',
  description: '获取指定城市的天气信息（使用 OpenWeatherMap API）',
  parameters: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', description: '城市名称（中文或英文）' },
      apiKey: { type: 'string', description: 'OpenWeatherMap API Key（可选）' },
    },
  },
  requiresConfirmation: false,
  category: 'query',
  execute: async (params): Promise<ToolResult> => {
    const city = params.city as string;
    const apiKey = (params.apiKey as string) || '7453d2a468f7ee10523b38d59d62b9e0';

    try {
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=zh_cn`
      );

      if (!response.ok) {
        const errorData = await response.json();
        return { success: false, error: errorData.message || '获取天气失败' };
      }

      const data = await response.json();
      return {
        success: true,
        data: {
          city: data.name,
          country: data.sys.country,
          temperature: data.main.temp,
          feelsLike: data.main.feels_like,
          humidity: data.main.humidity,
          windSpeed: data.wind.speed,
          description: data.weather[0].description,
          icon: `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取天气失败',
      };
    }
  },
};

export const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: '获取当前时间和日期',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
  category: 'query',
  execute: async (): Promise<ToolResult> => {
    const now = new Date();
    return {
      success: true,
      data: {
        datetime: now.toISOString(),
        localTime: now.toLocaleString('zh-CN'),
        localDate: now.toLocaleDateString('zh-CN'),
        localTimeOnly: now.toLocaleTimeString('zh-CN'),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestamp: now.getTime(),
      },
    };
  },
};
