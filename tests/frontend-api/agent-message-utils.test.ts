import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendManualStopMessage,
  mapRunMessagesToAgentMessages,
  mapSessionDetailToHistoryMessages,
  toInitialMessages,
  trimMessagesHistory,
} from '../../src/features/agent/runtime/messageUtils';
import { MAX_HISTORY_MESSAGES } from '../../src/features/agent/runtime/types';

test('trimMessagesHistory keeps the newest messages within history count', () => {
  const messages = Array.from({ length: MAX_HISTORY_MESSAGES + 5 }, (_, index) => ({
    id: `msg-${index}`,
    role: 'user' as const,
    content: `message-${index}`,
    timestamp: index,
    status: 'completed' as const,
  }));

  const trimmed = trimMessagesHistory(messages);

  assert.equal(trimmed.length, MAX_HISTORY_MESSAGES);
  assert.equal(trimmed[0]?.id, 'msg-5');
  assert.equal(trimmed.at(-1)?.id, `msg-${MAX_HISTORY_MESSAGES + 4}`);
});

test('mapRunMessagesToAgentMessages filters hidden system and tool result messages', () => {
  const mapped = mapRunMessagesToAgentMessages([
    { id: '1', role: 'system', content: 'system' },
    { id: '2', role: 'tool', content: 'tool' },
    { id: '3', role: 'user', content: '以下是工具执行结果: hidden' },
    { id: '4', role: 'user', content: 'visible user', createdAt: 10 },
    { id: '5', role: 'assistant', content: 'visible assistant', createdAt: 11 },
  ]);

  assert.deepEqual(mapped.map((message) => message.id), ['4', '5']);
  assert.equal(mapped[0]?.role, 'user');
  assert.equal(mapped[1]?.role, 'assistant');
});

test('mapSessionDetailToHistoryMessages falls back to runs when checkpoint messages are missing', () => {
  const messages = mapSessionDetailToHistoryMessages({
    id: 'session-1',
    title: 'session',
    createdAt: 1,
    updatedAt: 2,
    memoryStatus: 'idle',
    memoryDisabled: false,
    memoryUpdatedAt: null,
    memoryRunCount: 0,
    messages: [],
    memory: {
      summary: '',
      preferences: [],
      facts: [],
      goals: [],
      todos: [],
      rules: [],
      status: 'idle',
      updatedAt: null,
      disabled: false,
      runCount: 0,
    },
    runs: [
      {
        id: 'run-1',
        sessionId: 'session-1',
        status: 'completed',
        inputText: 'hello',
        model: 'test-model',
        createdAt: 100,
        updatedAt: 101,
        version: 1,
      },
      {
        id: 'run-2',
        sessionId: 'session-1',
        status: 'failed',
        inputText: 'retry',
        model: 'test-model',
        createdAt: 200,
        updatedAt: 201,
        version: 1,
      },
    ],
  });

  assert.equal(messages.length, 4);
  assert.equal(messages[0]?.content, 'hello');
  assert.equal(messages[1]?.content, '（回复内容不可用）');
  assert.equal(messages[3]?.status, 'error');
});

test('toInitialMessages keeps only user and assistant roles', () => {
  const initialMessages = toInitialMessages([
    { id: '1', role: 'system', content: 'system', timestamp: 1, status: 'completed' },
    { id: '2', role: 'user', content: 'user', timestamp: 2, status: 'completed' },
    { id: '3', role: 'assistant', content: 'assistant', timestamp: 3, status: 'completed' },
    { id: '4', role: 'tool', content: 'tool', timestamp: 4, status: 'completed' },
    { id: '5', role: 'assistant', content: '', timestamp: 5, status: 'streaming' },
    { id: '6', role: 'assistant', content: '   ', timestamp: 6, status: 'pending' },
  ]);

  assert.deepEqual(initialMessages, [
    { role: 'user', content: 'user' },
    { role: 'assistant', content: 'assistant' },
  ]);
});

test('appendManualStopMessage is idempotent', () => {
  const once = appendManualStopMessage('partial answer');
  const twice = appendManualStopMessage(once);

  assert.equal(once, 'partial answer\n\n已手动终止本次思考。');
  assert.equal(twice, once);
});
