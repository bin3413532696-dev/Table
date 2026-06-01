import assert from 'node:assert/strict';
import test from 'node:test';

import { getKnowledgeMetadata } from '../../src/pages/Knowledge/api';
import { installFetchMock } from './helpers';

test('getKnowledgeMetadata reads data envelope', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({
    data: {
      noteCount: 12,
      presetTagCount: 4,
    },
    source: 'postgres',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const metadata = await getKnowledgeMetadata();
    assert.equal(metadata.noteCount, 12);
    assert.equal(metadata.presetTagCount, 4);
  } finally {
    mock.restore();
  }
});
