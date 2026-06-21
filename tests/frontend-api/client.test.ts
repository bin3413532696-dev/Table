import assert from 'node:assert/strict';
import test from 'node:test';
import { ErrorCode, isAppError } from '../../src/core/errors';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, fetchWithAuth } from '../../src/shared/auth';
import { requestApi } from '../../src/shared/api/client';
import { readApiErrorMessage } from '../../src/shared/api/error';
import { getHeader, installFetchMock } from './helpers';

test('requestApi adds JSON content-type for JSON bodies', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    await requestApi<{ ok: boolean }>('/api/test', {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' }),
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(getHeader(mock.calls[0].init?.headers, 'Content-Type'), 'application/json');
  } finally {
    mock.restore();
  }
});

test('requestApi does not force JSON content-type for FormData bodies', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const formData = new FormData();
    formData.append('file', new Blob(['demo']), 'demo.txt');

    await requestApi<{ ok: boolean }>('/api/upload', {
      method: 'POST',
      body: formData,
    });

    assert.equal(mock.calls.length, 1);
    assert.equal(getHeader(mock.calls[0].init?.headers, 'Content-Type'), null);
  } finally {
    mock.restore();
  }
});

test('requestApi returns undefined for 204 responses', async () => {
  const mock = installFetchMock(async () => new Response(null, { status: 204 }));

  try {
    const result = await requestApi<void>('/api/empty');
    assert.equal(result, undefined);
  } finally {
    mock.restore();
  }
});

test('fetchWithAuth does not attach CSRF header to GET requests', async () => {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'table_dev_csrf_token=test-token' },
  });

  const mock = installFetchMock(async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    await fetchWithAuth('/api/test');
    assert.equal(mock.calls.length, 1);
    assert.equal(getHeader(mock.calls[0].init?.headers, CSRF_HEADER_NAME), null);
  } finally {
    mock.restore();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  }
});

test('fetchWithAuth bootstraps CSRF cookie before first write request', async () => {
  const originalDocument = globalThis.document;
  let cookieValue = '';

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      get cookie() {
        return cookieValue;
      },
      set cookie(value: string) {
        cookieValue = value;
      },
    },
  });

  const mock = installFetchMock(async (input) => {
    if (input === '/api/auth/me') {
      document.cookie = `${CSRF_COOKIE_NAME}=bootstrapped-token`;
      return new Response(JSON.stringify({ data: { auth: {}, user: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    await fetchWithAuth('/api/tasks/', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test task' }),
    });

    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[0].input, '/api/auth/me');
    assert.equal(mock.calls[1].input, '/api/tasks/');
    assert.equal(getHeader(mock.calls[1].init?.headers, CSRF_HEADER_NAME), 'bootstrapped-token');
  } finally {
    mock.restore();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  }
});

test('requestApi maps 404 responses to AppError', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({ message: 'missing entity' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    await assert.rejects(
      () => requestApi('/api/missing'),
      (error: unknown) =>
        isAppError(error) &&
        error.code === ErrorCode.ENTITY_NOT_FOUND &&
        error.message.includes('missing entity')
    );
  } finally {
    mock.restore();
  }
});

test('readApiErrorMessage prefers standard error payload fields', async () => {
  const response = new Response(JSON.stringify({ error: 'NOT_FOUND', message: 'missing entity' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

  const message = await readApiErrorMessage(response, 'fallback');
  assert.equal(message, 'missing entity');
});
