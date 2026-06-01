import assert from 'node:assert/strict';
import test from 'node:test';
import { getNoteById, searchNotes } from '../../src/pages/Knowledge/api';
import { installFetchMock } from './helpers';

test('getNoteById returns null on 404', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({ message: 'not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const result = await getNoteById('missing-note');
    assert.equal(result, null);
  } finally {
    mock.restore();
  }
});

test('searchNotes serializes query parameters and returns items', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({
    items: [
      {
        id: 'note-1',
        title: 'First note',
        tags: ['alpha'],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    total: 1,
    source: 'postgres',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const result = await searchNotes({
      query: 'budget',
      tags: ['alpha', 'beta'],
      limit: 5,
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(
      String(mock.calls[0].input),
      '/api/knowledge/search?query=budget&tags=alpha%2Cbeta&limit=5'
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'note-1');
  } finally {
    mock.restore();
  }
});
