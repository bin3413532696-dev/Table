import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

import App from '../../src/app/App';
import { renderWithDom, testingLibrary } from './dom-test-helpers';

test('App renders router when PIN is disabled', { concurrency: false }, async () => {
  const authModule = await import('../../src/shared/auth');
  const routerModule = await import('../../src/app/router');

  const originalFetchPinStatus = authModule.fetchPinStatus;
  const originalRouter = routerModule.AppRouter;

  authModule.fetchPinStatus = async () => ({ enabled: false });
  routerModule.AppRouter = () => React.createElement('div', null, 'router-loaded');

  try {
    const { waitFor } = testingLibrary();
    const view = renderWithDom(React.createElement(App));

    await waitFor(() => {
      assert.equal(view.getByText('router-loaded').textContent, 'router-loaded');
    });
  } finally {
    authModule.fetchPinStatus = originalFetchPinStatus;
    routerModule.AppRouter = originalRouter;
  }
});

test('App shows retry state when PIN status check fails', { concurrency: false }, async () => {
  const authModule = await import('../../src/shared/auth');

  const originalFetchPinStatus = authModule.fetchPinStatus;
  let calls = 0;
  authModule.fetchPinStatus = async () => {
    calls += 1;
    throw new Error('网络异常');
  };

  try {
    const { fireEvent, waitFor } = testingLibrary();
    const view = renderWithDom(React.createElement(App));

    await waitFor(() => {
      assert.equal(view.getByText('网络异常').textContent, '网络异常');
    });

    fireEvent.click(view.getByText('重试'));
    await waitFor(() => {
      assert.ok(calls >= 2);
    });
  } finally {
    authModule.fetchPinStatus = originalFetchPinStatus;
  }
});
