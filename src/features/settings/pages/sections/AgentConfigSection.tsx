import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Edit2, Eye, EyeOff, Globe, MessageSquare, Plus, Power, Settings as SettingsIcon, Sparkles, Trash2 as TrashIcon, Zap } from 'lucide-react';

import { Button } from '../../../../components/ui';
import { MESSAGES } from '../../../../core/messages';
import type { AgentCapabilitiesDto, AgentPersonaDto } from '../../../agent/public';
import {
  loadAgentCapabilities,
  loadAgentPersona,
  PERSONA_TEMPLATES,
  saveAgentPersona,
  type ProviderModelOption,
} from '../../api/agent';
import {
  activateApiConfig,
  type ApiProvider,
  deleteApiConfig,
  ensureBootstrappedApiConfig,
  fetchProviderModels,
  getApiConfigs,
  refreshApiConfigs,
  saveApiConfigs,
} from '../../api/providers';

const personaTemplateIcons: Record<(typeof PERSONA_TEMPLATES)[number]['name'], typeof Bot> = {
  默认: Bot,
  专业助手: Sparkles,
  亲切伙伴: MessageSquare,
  极简模式: Zap,
};

type PersonaTemplate = (typeof PERSONA_TEMPLATES)[number];

export function AgentConfigSection() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ProviderModelOption[]>([]);
  const [fetchModelsError, setFetchModelsError] = useState('');
  const [providerError, setProviderError] = useState('');
  const [formData, setFormData] = useState<{
    name: string;
    apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
    baseUrl: string;
    apiKey: string;
    model: string;
    embeddingModel: string;
    rerankerModel: string;
    headers: string;
  }>({
    name: '',
    apiFormat: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    embeddingModel: '',
    rerankerModel: '',
    headers: '',
  });
  const [editingApiKeyPreview, setEditingApiKeyPreview] = useState('');

  const [persona, setPersona] = useState<AgentPersonaDto>({ systemPrompt: '' });
  const [loadingPersona, setLoadingPersona] = useState(false);
  const [savingPersona, setSavingPersona] = useState(false);
  const [personaSaved, setPersonaSaved] = useState(false);
  const [personaError, setPersonaError] = useState('');
  const [capabilities, setCapabilities] = useState<AgentCapabilitiesDto>({ tools: [], providers: [] });
  const [loadingCapabilities, setLoadingCapabilities] = useState(false);

  const apiFormats = [
    { value: 'openai', label: 'OpenAI Chat Completions' },
    { value: 'anthropic', label: 'Anthropic Messages' },
    { value: 'gemini', label: 'Gemini Native generateContent' },
    { value: 'custom', label: '自定义 API' },
  ];

  const defaultModelsByFormat: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-3-5-sonnet-20241022',
    gemini: 'gemini-1.5-pro',
    custom: '',
  };

  const getDefaultBaseUrl = (format: string) => {
    switch (format) {
      case 'openai': return 'https://api.openai.com/v1';
      case 'anthropic': return 'https://api.anthropic.com/v1';
      case 'gemini': return 'https://generativelanguage.googleapis.com/v1';
      default: return '';
    }
  };

  const fetchModels = async () => {
    setFetchingModels(true);
    setFetchModelsError('');

    try {
      const models = await fetchProviderModels({
        baseUrl: formData.baseUrl,
        apiKey: formData.apiKey,
        apiFormat: formData.apiFormat,
      });

      setFetchedModels(models);
      if (models.length === 0) {
        setFetchModelsError('无法获取模型列表，请手动配置模型名称');
      }
    } catch (error) {
      setFetchModelsError(error instanceof Error ? error.message : MESSAGES.settings.fetchModelsFailed);
    } finally {
      setFetchingModels(false);
    }
  };

  useEffect(() => {
    let disposed = false;

    const loadProviders = async () => {
      setLoadingProviders(true);
      setProviderError('');
      try {
        await ensureBootstrappedApiConfig();
        if (!disposed) {
          setProviders(getApiConfigs());
        }
      } catch (error) {
        if (!disposed) {
          setProviderError(error instanceof Error ? error.message : MESSAGES.settings.loadProviderFailed);
        }
      } finally {
        if (!disposed) {
          setLoadingProviders(false);
        }
      }
    };

    void loadProviders();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const loadCapabilities = async () => {
      setLoadingCapabilities(true);
      try {
        const data = await loadAgentCapabilities();
        if (!disposed) {
          setCapabilities(data);
        }
      } catch (error) {
        console.warn('[Settings] Failed to load agent capabilities:', error);
      } finally {
        if (!disposed) {
          setLoadingCapabilities(false);
        }
      }
    };

    void loadCapabilities();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const loadPersona = async () => {
      setLoadingPersona(true);
      try {
        const data = await loadAgentPersona();
        if (!disposed) {
          setPersona(data);
        }
      } catch (error) {
        console.warn('[Settings] Failed to load persona:', error);
      } finally {
        if (!disposed) {
          setLoadingPersona(false);
        }
      }
    };

    void loadPersona();
    return () => {
      disposed = true;
    };
  }, []);

  const handleSavePersona = async () => {
    setSavingPersona(true);
    setPersonaError('');
    try {
      const updated = await saveAgentPersona(persona.systemPrompt);
      setPersona(updated);
      setPersonaSaved(true);
      setTimeout(() => setPersonaSaved(false), 2000);
    } catch (error) {
      console.error('[Settings] Failed to save persona:', error);
      setPersonaError(error instanceof Error ? error.message : '保存人格配置失败');
    } finally {
      setSavingPersona(false);
    }
  };

  const handleApplyTemplate = (template: PersonaTemplate) => {
    setPersona({ systemPrompt: template.prompt });
    setPersonaError('');
  };

  const handleResetPersona = () => {
    setPersona({ systemPrompt: PERSONA_TEMPLATES[0].prompt });
    setPersonaError('');
  };

  const handleAdd = () => {
    setEditingProvider(null);
    setEditingApiKeyPreview('');
    setFormData({
      name: '',
      apiFormat: 'openai',
      baseUrl: getDefaultBaseUrl('openai'),
      apiKey: '',
      model: defaultModelsByFormat.openai,
      embeddingModel: 'text-embedding-3-small',
      rerankerModel: '',
      headers: '',
    });
    setFetchedModels([]);
    setFetchModelsError('');
    setProviderError('');
    setShowForm(true);
  };

  const handleEdit = (provider: ApiProvider) => {
    setEditingProvider(provider);
    setEditingApiKeyPreview(provider.apiKeyPreview || (provider.hasApiKey ? '已配置 API Key' : ''));
    setFormData({
      name: provider.name,
      apiFormat: provider.apiFormat,
      baseUrl: provider.baseUrl,
      apiKey: '',
      model: provider.model || '',
      embeddingModel: provider.embeddingModel || '',
      rerankerModel: provider.rerankerModel || '',
      headers: provider.headers ? JSON.stringify(provider.headers, null, 2) : '',
    });
    setFetchedModels([]);
    setFetchModelsError('');
    setProviderError('');
    setShowForm(true);
  };

  const handleApiFormatChange = (format: string) => {
    setFormData((prev) => ({
      ...prev,
      apiFormat: format as ApiProvider['apiFormat'],
      baseUrl: getDefaultBaseUrl(format),
      model: defaultModelsByFormat[format] || '',
    }));
  };

  const handleActivate = async (id: string) => {
    setProviderError('');
    try {
      const nextProviders = await activateApiConfig(id);
      setProviders(nextProviders);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : MESSAGES.settings.activateProviderFailed);
    }
  };

  const handleDelete = async (id: string) => {
    setProviderError('');
    try {
      const nextProviders = await deleteApiConfig(id);
      setProviders(nextProviders);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : MESSAGES.settings.deleteProviderFailed);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.baseUrl) {
      setProviderError('请填写名称和基础URL');
      return;
    }

    let headers: Record<string, string> | undefined;
    if (formData.headers) {
      try {
        headers = JSON.parse(formData.headers);
      } catch {
        setProviderError('headers 格式不正确，应为 JSON');
        return;
      }
    }

    const newProvider: ApiProvider = {
      id: editingProvider?.id || crypto.randomUUID(),
      name: formData.name,
      isActive: editingProvider?.isActive ?? (providers.length === 0),
      apiFormat: formData.apiFormat,
      baseUrl: formData.baseUrl,
      apiKey: formData.apiKey,
      hasApiKey: editingProvider?.hasApiKey,
      apiKeyPreview: editingProvider?.apiKeyPreview,
      model: formData.model,
      embeddingModel: formData.embeddingModel,
      rerankerModel: formData.rerankerModel,
      headers,
    };

    try {
      const newProviders = editingProvider
        ? providers.map((provider) => (provider.id === editingProvider.id ? newProvider : provider))
        : [...providers, newProvider];

      await saveApiConfigs(newProviders);
      const latestProviders = await refreshApiConfigs();
      setProviders(latestProviders);
      setProviderError('');
      setShowForm(false);
      setEditingProvider(null);
      setFetchedModels([]);
      setFetchModelsError('');
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : MESSAGES.settings.saveProviderFailed);
    }
  };

  const activeProvider = providers.find((provider) => provider.isActive);

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
        <div className="flex items-start gap-3">
          <Globe className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-text-primary">Provider 配置</h4>
            <p className="text-sm mt-1 text-text-muted">配置 AI Provider，激活的 Provider 将被智能体使用。</p>
          </div>
        </div>
      </div>

      {providerError && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-sm text-error">
          {providerError}
        </div>
      )}

      {activeProvider && (
        <div className="p-4 rounded-lg bg-success/10 border border-success/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-success/20 flex items-center justify-center">
              <Power className="w-4 h-4 text-success" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-text-primary">{activeProvider.name}</h4>
                <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">已激活</span>
              </div>
              <p className="text-sm text-text-muted">{activeProvider.baseUrl}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleEdit(activeProvider)}
                className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          {(activeProvider.model || activeProvider.embeddingModel || activeProvider.rerankerModel) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeProvider.model && (
                <span className="text-xs px-2 py-1 rounded-full bg-bg-secondary text-text-secondary">
                  模型: {activeProvider.model}
                </span>
              )}
              {activeProvider.embeddingModel && (
                <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                  Embedding: {activeProvider.embeddingModel}
                </span>
              )}
              {activeProvider.rerankerModel && (
                <span className="text-xs px-2 py-1 rounded-full bg-warning/10 text-warning">
                  Reranker: {activeProvider.rerankerModel}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <Button variant="primary" onClick={handleAdd} icon={<Plus className="w-4 h-4" />}>
        添加 Provider
      </Button>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
            <h4 className="font-medium text-text-primary mb-3">{editingProvider ? '编辑 Provider' : '添加 Provider'}</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1.5 text-text-secondary">Provider 名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如：OpenAI、Claude、Gemini"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 text-text-secondary">API 格式</label>
                <select
                  value={formData.apiFormat}
                  onChange={(e) => handleApiFormatChange(e.target.value)}
                  className="input"
                >
                  {apiFormats.map((format) => (
                    <option key={format.value} value={format.value}>{format.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 text-text-secondary">Base URL *</label>
                <input
                  type="text"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 text-text-secondary">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    placeholder={editingProvider?.hasApiKey ? '留空则保留当前密钥，输入则覆盖' : '输入 API Key'}
                    className="input pr-10"
                  />
                  <button onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {editingProvider?.hasApiKey && !formData.apiKey && (
                  <p className="text-xs text-text-muted mt-1">当前已配置密钥：{editingApiKeyPreview || '已隐藏'}</p>
                )}
              </div>

              {formData.baseUrl && formData.apiKey && (
                <div>
                  <Button variant="secondary" onClick={() => void fetchModels()} disabled={fetchingModels} className="w-full">
                    {fetchingModels ? '获取中...' : '获取模型列表'}
                  </Button>
                  {fetchModelsError && <p className="text-error text-sm mt-2">{fetchModelsError}</p>}
                  {fetchedModels.length > 0 && <p className="text-success text-sm mt-2">已获取 {fetchedModels.length} 个模型</p>}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1.5 text-text-secondary">模型</label>
                <select
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="input mb-2"
                >
                  <option value="">请选择模型（或手动输入）</option>
                  {(fetchedModels.length > 0 ? fetchedModels : [{ name: defaultModelsByFormat[formData.apiFormat], label: defaultModelsByFormat[formData.apiFormat] || '默认模型' }]).map((model) => (
                    model.name && <option key={model.name} value={model.name}>{model.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  placeholder="或直接输入模型名称"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 text-text-secondary">Embedding 模型</label>
                <input
                  type="text"
                  value={formData.embeddingModel}
                  onChange={(e) => setFormData({ ...formData, embeddingModel: e.target.value })}
                  placeholder="text-embedding-3-small"
                  className="input"
                />
                <p className="text-xs text-text-muted mt-1">用于RAG知识库检索的向量模型，留空则使用默认 text-embedding-3-small</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 text-text-secondary">Reranker 模型</label>
                <input
                  type="text"
                  value={formData.rerankerModel}
                  onChange={(e) => setFormData({ ...formData, rerankerModel: e.target.value })}
                  placeholder="如: rerank-v3.5"
                  className="input"
                />
                <p className="text-xs text-text-muted mt-1">用于RAG检索重排序的模型，需服务端支持 Cohere /rerank API 格式</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5 text-text-secondary">自定义 Headers (JSON)</label>
                <textarea
                  value={formData.headers}
                  onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                  placeholder='{"X-Custom-Header": "value"}'
                  rows={2}
                  className="input resize-none font-mono text-sm"
                />
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setShowForm(false)}>取消</Button>
                <Button variant="primary" onClick={() => void handleSave()}>保存</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2">
        {loadingProviders ? (
          <div className="text-center py-12 text-text-muted">
            <p>正在加载 Provider 配置...</p>
          </div>
        ) : providers.length === 0 ? (
          <div className="text-center py-12 text-text-muted">
            <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>暂无 Provider 配置</p>
            <p className="text-sm mt-1">点击上方按钮添加第一个 Provider</p>
          </div>
        ) : (
          providers.map((provider) => (
            <motion.div key={provider.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="rounded-lg bg-bg-secondary border border-border-primary overflow-hidden">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${provider.isActive ? 'bg-success/20' : 'bg-bg-hover'}`}>
                    <Globe className={`w-4 h-4 ${provider.isActive ? 'text-success' : 'text-text-muted'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-text-primary">{provider.name}</h4>
                      {provider.isActive && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">激活</span>
                      )}
                    </div>
                    <p className="text-sm text-text-muted">{provider.baseUrl}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!provider.isActive && (
                    <button
                      onClick={() => void handleActivate(provider.id)}
                      className="p-2 text-text-secondary hover:text-success hover:bg-success/5 rounded-lg transition-colors"
                      title="激活"
                    >
                      <Power className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(provider)}
                    className="p-2 text-text-secondary hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => void handleDelete(provider.id)}
                    className="p-2 text-text-secondary hover:text-error hover:bg-error/5 rounded-lg transition-colors"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {(provider.model || provider.embeddingModel || provider.rerankerModel) && (
                <div className="px-4 pb-4 flex flex-wrap gap-2">
                  {provider.model && (
                    <span className="text-xs px-2 py-1 rounded-full bg-bg-primary text-text-secondary">
                      模型: {provider.model}
                    </span>
                  )}
                  {provider.embeddingModel && (
                    <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                      Embedding: {provider.embeddingModel}
                    </span>
                  )}
                  {provider.rerankerModel && (
                    <span className="text-xs px-2 py-1 rounded-full bg-warning/10 text-warning">
                      Reranker: {provider.rerankerModel}
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          ))
        )}
      </div>

      <div className="p-4 rounded-lg bg-info/10 border border-info/20">
        <h4 className="font-medium text-text-primary mb-1.5">使用说明</h4>
        <ul className="text-sm text-text-muted space-y-1">
          <li>• 激活的 Provider 将被智能体使用</li>
          <li>• 配置模型名称后，智能体将使用指定的模型</li>
        </ul>
      </div>

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
          <SettingsIcon className="w-4 h-4" />
          可用工具
        </h4>
        <p className="text-sm text-text-muted mb-2">
          当前智能体已注册 <span className="text-primary font-medium">{capabilities.tools.length}</span> 个工具
        </p>
        {loadingCapabilities ? (
          <p className="text-sm text-text-muted">正在加载工具元数据...</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {capabilities.tools.map((tool) => (
              <span
                key={tool.name}
                className={`text-xs px-2 py-1 rounded-full border ${
                  tool.category === 'mutation'
                    ? 'bg-warning/10 text-warning border-warning/20'
                    : tool.requiresRag
                      ? 'bg-info/10 text-info border-info/20'
                      : 'bg-primary/10 text-primary border-primary/20'
                }`}
                title={tool.description}
              >
                {tool.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 rounded-lg bg-bg-secondary border border-border-primary">
        <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
          <Bot className="w-4 h-4" />
          智能体人格设置
        </h4>
        <p className="text-sm text-text-muted mb-3">
          自定义智能体的系统提示词，影响智能体的回复风格和行为。留空则使用默认配置。
        </p>
        <div className="p-3 rounded-lg bg-info/10 border border-info/20 mb-3">
          <p className="text-xs text-info">
            ⚠️ 新的人格配置仅在<strong>新会话</strong>中生效。已有会话使用的是创建时的人格配置，更换人格后需点击智能体侧边栏的"新建会话"按钮开始新对话。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {PERSONA_TEMPLATES.map((template) => {
            const Icon = personaTemplateIcons[template.name];
            return (
              <button
                key={template.name}
                onClick={() => handleApplyTemplate(template)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-bg-primary border border-border-primary hover:border-primary hover:text-primary transition-colors"
              >
                <Icon className="w-3.5 h-3.5" />
                {template.name}
              </button>
            );
          })}
        </div>

        <textarea
          value={persona.systemPrompt}
          onChange={(e) => {
            setPersona({ systemPrompt: e.target.value });
            setPersonaError('');
          }}
          placeholder="输入自定义系统提示词..."
          className="w-full h-48 md:h-64 p-3 text-sm border border-border-primary rounded-lg resize-none focus:outline-none focus:border-primary bg-bg-primary placeholder:text-text-muted"
          disabled={loadingPersona || savingPersona}
        />
        {personaError && <p className="text-error text-xs mt-2">{personaError}</p>}

        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-text-muted">
            最多 5000 字符，当前 {persona.systemPrompt.length} 字
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetPersona}
              className="px-3 py-1.5 text-xs rounded-lg border border-border-primary hover:bg-bg-primary transition-colors"
              disabled={savingPersona}
            >
              重置为默认
            </button>
            <Button
              variant="primary"
              onClick={() => void handleSavePersona()}
              disabled={savingPersona || loadingPersona}
            >
              {savingPersona ? '保存中...' : personaSaved ? '已保存' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
