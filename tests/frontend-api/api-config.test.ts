import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearProviderCache,
  getActiveApiConfig,
  getApiConfigs,
  getPreferredAgentModel,
  refreshApiConfigs,
} from '../../src/lib/apiConfig';
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
