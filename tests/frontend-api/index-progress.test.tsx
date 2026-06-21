import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

import { IndexProgress } from '../../src/features/knowledge/components/IndexProgress';
import type { IndexJob } from '../../src/features/knowledge/types';
import { renderWithDom, testingLibrary } from './dom-test-helpers';

function makeJob(overrides: Partial<IndexJob> = {}): IndexJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    documentId: 'doc-1',
    jobType: 'reindex',
    status: 'completed',
    progress: 100,
    error: null,
    startedAt: 1,
    completedAt: 2,
    createdAt: 1,
    ...overrides,
  };
}

test('IndexProgress shows warning when job completed with recoverable error details', { concurrency: false }, async () => {
  const ragModule = require('../../src/features/knowledge/api/rag') as typeof import('../../src/features/knowledge/api/rag');
  const originalGetJobs = ragModule.getJobs;
  const onCompleteCalls: number[] = [];

  ragModule.getJobs = async () => ({
    items: [
      makeJob({
        error: {
          message: 'Embedding request failed: HTTP 400',
        },
      }),
    ],
    total: 1,
  });

  try {
    const { waitFor } = testingLibrary();
    const view = renderWithDom(React.createElement(IndexProgress, {
      documentId: 'doc-1',
      onComplete: () => onCompleteCalls.push(1),
    }));

    await waitFor(() => {
      assert.equal(view.getByText('索引任务: 已完成').textContent, '索引任务: 已完成');
      assert.equal(
        view.getByText('警告: Embedding request failed: HTTP 400').textContent,
        '警告: Embedding request failed: HTTP 400',
      );
      assert.equal(onCompleteCalls.length, 1);
    });

    view.unmount();
  } finally {
    ragModule.getJobs = originalGetJobs;
  }
});
