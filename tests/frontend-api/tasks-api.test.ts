import assert from 'node:assert/strict';
import test from 'node:test';

import { taskApi } from '../../src/lib/api/tasks';
import { syncEngine } from '../../src/sync';
import { taskStore } from '../../src/store/impl';
import { installFetchMock } from './helpers';

test('taskApi.getAll normalizes null optional fields from server', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({
    items: [
      {
        id: '00000000-0000-0000-0000-000000000101',
        title: 'Task A',
        completed: false,
        priority: 'medium',
        dueDate: null,
        notes: null,
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
    const tasks = await taskApi.getAll();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].dueDate, undefined);
  } finally {
    mock.restore();
    taskStore.hydrate([], false);
  }
});

test('taskApi.add accepts created task when server returns null dueDate', async () => {
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
      id: '00000000-0000-0000-0000-000000000102',
      title: 'Task B',
      completed: false,
      priority: 'high',
      dueDate: null,
      notes: null,
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
    const task = await taskApi.add({
      title: 'Task B',
      completed: false,
      priority: 'high',
      createdAt,
      updatedAt: createdAt,
    });

    assert.equal(task.dueDate, undefined);

    const storedTasks = await taskStore.getAll();
    assert.equal(storedTasks.length, 1);
    assert.equal(storedTasks[0].id, task.id);
  } finally {
    mock.restore();
    syncEngine.loadKnowledgeFromServer = originalLoadKnowledge;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
    taskStore.hydrate([], false);
  }
});
