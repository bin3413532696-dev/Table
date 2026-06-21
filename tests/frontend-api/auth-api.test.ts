import assert from 'node:assert/strict';
import test from 'node:test';

import { switchAuthSession } from '../../src/shared/auth';
import { installFetchMock } from './helpers';

test('switchAuthSession surfaces backend standard error messages', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({
    error: 'NOT_FOUND',
    message: 'User not found or inactive',
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    await assert.rejects(
      () => switchAuthSession('00000000-0000-0000-0000-000000000099'),
      (error: unknown) => error instanceof Error && error.message === 'User not found or inactive',
    );
  } finally {
    mock.restore();
  }
});
