import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteAgentSessionMemory,
  extractMessageTextFromLangGraphChunk,
  fetchAgentCapabilities,
  fetchAgentSessionMemory,
  streamAgentRun,
  updateAgentSessionMemorySettings,
} from '../../src/features/agent/api';
import { getHeader, installFetchMock } from './helpers';

function createRunDetail() {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    status: 'completed' as const,
    inputText: 'hello',
    model: 'gpt-test',
    createdAt: 1,
    updatedAt: 2,
    version: 1,
    messages: [],
    executedToolCalls: [],
    pendingToolCalls: [],
    requiresConfirmation: false,
    finalText: 'done',
    iterationCount: 1,
    assistantTextChunks: ['done'],
    timeline: [],
  };
}

test('streamAgentRun parses SSE events and returns final run payload', async () => {
  const events: string[] = [];
  const finalRun = createRunDetail();
  const body = [
    'event: metadata',
    'data: {"type":"metadata","runId":"run-1","sessionId":"session-1","model":"gpt-test"}',
    '',
    'event: message',
    `data: ${JSON.stringify({ type: 'run_update', run: finalRun })}`,
    '',
    'event: done',
    'data: {"ok":true}',
    '',
  ].join('\n');

  const mock = installFetchMock(async () => new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }
  ));

  try {
    const result = await streamAgentRun(
      { inputText: 'hello', model: 'gpt-test' },
      {
        onEvent: (event) => events.push(event.type),
      }
    );

    assert.equal(mock.calls.length, 1);
    assert.deepEqual(events, ['metadata', 'run_update']);
    assert.equal(result.id, 'run-1');
    assert.equal(result.finalText, 'done');
  } finally {
    mock.restore();
  }
});

test('streamAgentRun tolerates SSE id, retry, and comment fields', async () => {
  const events: string[] = [];
  const finalRun = createRunDetail();
  const body = [
    ': keep-alive',
    'id: 17',
    'retry: 5000',
    'event: metadata',
    'data: {"type":"metadata","runId":"run-1","sessionId":"session-1","model":"gpt-test"}',
    '',
    ': second event comment',
    'event: run_completed',
    `data: ${JSON.stringify({ type: 'run_completed', run: finalRun })}`,
    '',
    'event: done',
    'data: {"ok":true}',
    '',
  ].join('\n');

  const mock = installFetchMock(async () => new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }
  ));

  try {
    const result = await streamAgentRun(
      { inputText: 'hello', model: 'gpt-test' },
      {
        onEvent: (event) => events.push(event.type),
      }
    );

    assert.deepEqual(events, ['metadata', 'run_completed']);
    assert.equal(result.id, 'run-1');
  } finally {
    mock.restore();
  }
});

test('streamAgentRun surfaces SSE error events', async () => {
  const body = [
    'event: error',
    'data: {"message":"provider unavailable"}',
    '',
  ].join('\n');

  const mock = installFetchMock(async () => new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }
  ));

  try {
    await assert.rejects(
      () => streamAgentRun({ inputText: 'hello', model: 'gpt-test' }),
      (error: unknown) => error instanceof Error && error.message === 'provider unavailable'
    );
  } finally {
    mock.restore();
  }
});

test('extractMessageTextFromLangGraphChunk joins structured text content', () => {
  const text = extractMessageTextFromLangGraphChunk({
    type: 'langgraph_chunk',
    mode: 'messages',
    chunk: [
      'messages',
      {
        content: [
          { text: '你好' },
          '，',
          { text: '世界' },
        ],
      },
    ],
  });

  assert.equal(text, '你好，世界');
});

test('fetchAgentSessionMemory requests the session memory endpoint', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({
    summary: 'prefers concise answers',
    preferences: ['concise'],
    facts: [],
    goals: [],
    todos: [],
    rules: [],
    status: 'ready',
    updatedAt: 10,
    disabled: false,
    runCount: 3,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const result = await fetchAgentSessionMemory('session-1');
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0]?.input, '/api/agent/sessions/session-1/memory');
    assert.equal(result.status, 'ready');
    assert.equal(result.runCount, 3);
  } finally {
    mock.restore();
  }
});

test('fetchAgentCapabilities requests the capabilities endpoint', async () => {
  const mock = installFetchMock(async () => new Response(JSON.stringify({
    tools: [
      {
        name: 'query_tasks',
        description: 'List tasks',
        promptSignature: 'query_tasks({ completed?: boolean })',
        category: 'query',
        module: 'tasks',
        requiresConfirmation: false,
        requiresRag: false,
        enabled: true,
      },
    ],
    providers: [
      {
        apiFormat: 'openai',
        label: 'OpenAI Chat Completions',
        enabled: true,
      },
    ],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const result = await fetchAgentCapabilities();
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0]?.input, '/api/agent/capabilities');
    assert.equal(result.tools[0]?.name, 'query_tasks');
    assert.equal(result.providers[0]?.apiFormat, 'openai');
  } finally {
    mock.restore();
  }
});

test('session memory mutation APIs send JSON payloads', async () => {
  const mock = installFetchMock(async (_input, init) => new Response(JSON.stringify({
    summary: '',
    preferences: [],
    facts: [],
    goals: [],
    todos: [],
    rules: [],
    status: 'idle',
    updatedAt: null,
    disabled: init?.method === 'PATCH',
    runCount: 0,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const updated = await updateAgentSessionMemorySettings('session-1', { disabled: true });
    const deleted = await deleteAgentSessionMemory('session-1');

    assert.equal(updated.disabled, true);
    assert.equal(deleted.status, 'idle');
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[0]?.input, '/api/agent/sessions/session-1/memory/settings');
    assert.equal(mock.calls[1]?.input, '/api/agent/sessions/session-1/memory');
    assert.equal(mock.calls[0]?.init?.method, 'PATCH');
    assert.equal(getHeader(mock.calls[0]?.init?.headers, 'content-type'), 'application/json');
    assert.equal(mock.calls[0]?.init?.body, JSON.stringify({ disabled: true }));
    assert.equal(mock.calls[1]?.init?.method, 'DELETE');
  } finally {
    mock.restore();
  }
});
