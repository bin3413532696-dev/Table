import assert from 'node:assert/strict';
import test from 'node:test';

import { createCorpus, getCorpora, triggerIndex } from '../../src/features/knowledge/api/rag';
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

test('getCorpora requests the corpus list endpoint', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({
    items: [
      {
        id: 'corpus-1',
        userId: 'user-1',
        name: '热力学教材',
        description: '个人资料集',
        defaultTags: ['热力学'],
        documentIds: ['doc-1'],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    total: 1,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const result = await getCorpora();
    assert.equal(mock.calls[0]?.input, '/api/knowledge-rag/corpora');
    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.name, '热力学教材');
  } finally {
    mock.restore();
  }
});

test('createCorpus posts JSON payload to the corpus endpoint', async () => {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'table_dev_csrf_token=test-token' },
  });

  const mock = installFetchMock(async () => new Response(JSON.stringify({
    id: 'corpus-1',
    userId: 'user-1',
    name: '热力学教材',
    description: '个人资料集',
    defaultTags: ['热力学'],
    documentIds: ['doc-1'],
    createdAt: 1,
    updatedAt: 2,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const result = await createCorpus({
      name: '热力学教材',
      description: '个人资料集',
      defaultTags: ['热力学'],
      documentIds: ['doc-1'],
    });
    assert.equal(mock.calls[0]?.input, '/api/knowledge-rag/corpora');
    assert.equal(mock.calls[0]?.init?.method, 'POST');
    assert.equal(
      mock.calls[0]?.init?.body,
      JSON.stringify({
        name: '热力学教材',
        description: '个人资料集',
        defaultTags: ['热力学'],
        documentIds: ['doc-1'],
      })
    );
    assert.equal(result.documentIds[0], 'doc-1');
  } finally {
    mock.restore();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  }
});
