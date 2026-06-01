import assert from 'node:assert/strict';
import test from 'node:test';

import { financeApi } from '../../src/lib/api/finance';
import { syncEngine } from '../../src/sync';
import { financeStore } from '../../src/store/impl';
import { installFetchMock } from './helpers';

test('financeApi.getAll normalizes null model from server', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({
    items: [
      {
        id: '00000000-0000-0000-0000-000000000201',
        type: 'expense',
        amount: 88.5,
        description: 'Hosting',
        category: 'infra',
        date: '2026-05-31',
        model: null,
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 1000,
        version: 1,
      },
    ],
    total: 1,
    source: 'postgres',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const records = await financeApi.getAll();
    assert.equal(records.length, 1);
    assert.equal(records[0].model, undefined);
  } finally {
    mock.restore();
    financeStore.hydrate([], false);
  }
});

test('financeApi.add accepts created record when server returns null model', async () => {
  const originalDocument = globalThis.document;
  const originalLoadKnowledge = syncEngine.loadKnowledgeFromServer;

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'table_dev_csrf_token=test-token' },
  });

  syncEngine.loadKnowledgeFromServer = async () => ({ success: true });

  const createdAt = Date.now();
  const mock = installFetchMock(async () => new Response(JSON.stringify({
    data: {
      id: '00000000-0000-0000-0000-000000000202',
      type: 'income',
      amount: 1200,
      description: 'Settlement',
      category: 'project',
      date: '2026-05-31',
      model: null,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    },
    source: 'postgres',
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const record = await financeApi.add({
      type: 'income',
      amount: 1200,
      description: 'Settlement',
      category: 'project',
      date: '2026-05-31',
      createdAt,
      updatedAt: createdAt,
    });

    assert.equal(record.model, undefined);

    const storedRecords = await financeStore.getAll();
    assert.equal(storedRecords.length, 1);
    assert.equal(storedRecords[0].id, record.id);
  } finally {
    mock.restore();
    syncEngine.loadKnowledgeFromServer = originalLoadKnowledge;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
    financeStore.hydrate([], false);
  }
});
