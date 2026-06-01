import assert from 'node:assert/strict';
import test from 'node:test';
import { streamAgentRun } from '../../src/lib/agentApi';
import { installFetchMock } from './helpers';

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
