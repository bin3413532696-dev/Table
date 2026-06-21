import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import type { AgentMessage } from '../../src/features/agent/public';
import { renderWithDom, testingLibrary } from './dom-test-helpers';

function createAgentState(overrides: Partial<ReturnType<typeof createBaseState>> = {}) {
  return {
    ...createBaseState(),
    ...overrides,
  };
}

function createBaseState() {
  return {
    messages: [] as AgentMessage[],
    streamingContent: null,
    isProcessing: false,
    isConnected: true,
    selectedModel: 'glm-5',
    availableModels: ['glm-5'],
    confirmationRequest: null,
    error: null,
    currentRunId: null,
    currentSessionId: 'session-1',
    currentSessionMemory: null,
    ragEnabled: true,
  };
}

function renderDashboard(stateOverrides: Partial<ReturnType<typeof createBaseState>> = {}) {
  const publicModulePath = require.resolve('../../src/features/agent/public');
  const dashboardModulePath = require.resolve('../../src/features/dashboard/pages/DashboardPage');
  const originalPublicModule = require.cache[publicModulePath];
  const originalDashboardModule = require.cache[dashboardModulePath];
  const actualPublic = require(publicModulePath) as typeof import('../../src/features/agent/public');

  require.cache[publicModulePath] = {
    ...originalPublicModule,
    exports: {
      ...actualPublic,
      useAgent: () => ({
        state: createAgentState(stateOverrides),
        sendMessage: async () => {},
        stopThinking: () => {},
        confirmAction: async () => {},
        rejectAction: async () => {},
        clearConversation: () => {},
        newSession: () => {},
        checkConnection: async () => {},
        selectModel: () => {},
        loadHistoryRun: () => {},
        loadHistorySession: () => {},
        refreshSessionMemory: async () => {},
        deleteSessionMemory: async () => {},
        setSessionMemoryDisabled: async () => {},
        toggleRag: () => {},
      }),
      SessionMemoryCard: () => React.createElement('div', { 'data-testid': 'session-memory-card' }),
    },
  } as NodeModule;

  delete require.cache[dashboardModulePath];
  const DashboardPage = require(dashboardModulePath).default as typeof import('../../src/features/dashboard/pages/DashboardPage').default;

  const view = renderWithDom(
    React.createElement(MemoryRouter, null, React.createElement(DashboardPage)),
  );

  return {
    ...view,
    restore() {
      if (originalPublicModule) {
        require.cache[publicModulePath] = originalPublicModule;
      } else {
        delete require.cache[publicModulePath];
      }

      if (originalDashboardModule) {
        require.cache[dashboardModulePath] = originalDashboardModule;
      } else {
        delete require.cache[dashboardModulePath];
      }
    },
  };
}

test('dashboard empty state prioritizes chat workspace and keeps new session action visible', { concurrency: false }, async () => {
  const view = renderDashboard();
  try {
    assert.equal(view.getByRole('heading', { name: '智能体工作台' }).textContent, '智能体工作台');
    assert.equal(view.getByRole('button', { name: /新建会话/ }).textContent?.includes('新建会话'), true);
    assert.equal(view.getByTestId('dashboard-empty-state') instanceof HTMLElement, true);
    assert.equal(view.getByText('建议动作').textContent, '建议动作');
    assert.equal(view.getByText('快速进入模块').textContent, '快速进入模块');
    assert.equal(view.getByPlaceholderText('描述你的目标、资料来源，或下一步要处理的事情...').tagName, 'TEXTAREA');
  } finally {
    view.restore();
  }
});

test('dashboard conversation state renders message column and hides empty state shell', { concurrency: false }, async () => {
  const view = renderDashboard({
    messages: [
      {
        id: 'm1',
        role: 'user' as const,
        content: '帮我安排今天的工作',
        timestamp: Date.now(),
        status: 'completed' as const,
      },
      {
        id: 'm2',
        role: 'assistant' as const,
        content: '先确认优先级，再分配时间块。',
        timestamp: Date.now(),
        status: 'completed' as const,
      },
    ],
  });

  try {
    assert.equal(view.queryByTestId('dashboard-empty-state'), null);
    assert.equal(view.getByText('帮我安排今天的工作').textContent, '帮我安排今天的工作');
    assert.equal(view.getByText('先确认优先级，再分配时间块。').textContent, '先确认优先级，再分配时间块。');
    assert.equal(view.getByTestId('session-memory-card') instanceof HTMLElement, true);
  } finally {
    view.restore();
  }
});

test('dashboard suggested prompt fills the input area', { concurrency: false }, async () => {
  const view = renderDashboard();
  try {
    const { fireEvent } = testingLibrary();
    const textarea = view.getByPlaceholderText(
      '描述你的目标、资料来源，或下一步要处理的事情...',
    ) as HTMLTextAreaElement;

    fireEvent.click(view.getByRole('button', { name: '帮我整理今天最重要的三件事' }));
    assert.equal(textarea.value, '帮我整理今天最重要的三件事');
  } finally {
    view.restore();
  }
});
