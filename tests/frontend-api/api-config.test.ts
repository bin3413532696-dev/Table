import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearProviderCache,
  fetchProviderModels,
  getActiveApiConfig,
  getApiConfigs,
  getPreferredAgentModel,
  parseProviderModelOptions,
  refreshApiConfigs,
} from '../../src/features/settings/api/providers';
import { installFetchMock } from './helpers';

test('refreshApiConfigs reads provider list envelope and updates cache', async () => {
  clearProviderCache();

  const mock = installFetchMock(async () => new Response(JSON.stringify({
    data: {
      items: [
        {
          id: '00000000-0000-0000-0000-000000000401',
          name: 'Provider A',
          isActive: true,
          apiFormat: 'openai',
          baseUrl: 'https://api.example.com/v1',
          apiKey: '',
          hasApiKey: true,
          apiKeyPreview: 'sk-***',
          model: 'gpt-4o-mini',
          embeddingModel: null,
          rerankerModel: null,
          headers: { 'x-demo': '1' },
          createdAt: '2026-05-31T00:00:00Z',
          updatedAt: '2026-05-31T00:00:00Z',
          version: 1,
        },
      ],
      total: 1,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const providers = await refreshApiConfigs();

    assert.equal(mock.calls.length, 1);
    assert.equal(String(mock.calls[0].input), '/api/providers');
    assert.equal(providers.length, 1);
    assert.equal(getApiConfigs().length, 1);
    assert.equal(getActiveApiConfig()?.id, '00000000-0000-0000-0000-000000000401');
    assert.equal(getPreferredAgentModel(), 'gpt-4o-mini');
  } finally {
    mock.restore();
    clearProviderCache();
  }
});

test('parseProviderModelOptions normalizes openai and gemini payloads', () => {
  const openaiModels = parseProviderModelOptions(
    {
      data: [
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      ],
    },
    'openai'
  );
  const geminiModels = parseProviderModelOptions(
    {
      models: [
        { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
      ],
    },
    'gemini'
  );

  assert.deepEqual(openaiModels, [{ name: 'gpt-4o-mini', label: 'GPT-4o Mini' }]);
  assert.deepEqual(geminiModels, [{ name: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }]);
});

test('fetchProviderModels tries standard model endpoints until one succeeds', async () => {
  const mock = installFetchMock(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/v1/models')) {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer sk-test');
      return new Response(JSON.stringify({
        data: [
          { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/models')) {
      return new Response('missing', { status: 404 });
    }
    return new Response('unexpected', { status: 500 });
  });

  try {
    const models = await fetchProviderModels({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'openai',
    });

    assert.equal(mock.calls.length, 2);
    assert.equal(String(mock.calls[0].input), 'https://api.example.com/models');
    assert.equal(String(mock.calls[1].input), 'https://api.example.com/v1/models');
    assert.deepEqual(models, [{ name: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' }]);
  } finally {
    mock.restore();
  }
});
