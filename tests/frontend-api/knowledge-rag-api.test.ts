import assert from 'node:assert/strict';
import test from 'node:test';

import { triggerIndex } from '../../src/pages/KnowledgeRag/api';
import { installFetchMock } from './helpers';

test('triggerIndex accepts message-only response when document is already indexed', async () => {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'table_dev_csrf_token=test-token' },
  });

  const mock = installFetchMock(async () => new Response(JSON.stringify({
    message: 'Document is already indexed; reindex is not required.',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const result = await triggerIndex('00000000-0000-0000-0000-000000000301', false);
    assert.equal(result.job, undefined);
    assert.equal(result.message, 'Document is already indexed; reindex is not required.');
  } finally {
    mock.restore();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  }
});
