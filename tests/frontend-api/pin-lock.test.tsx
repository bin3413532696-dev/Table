import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

import { PinLock } from '../../src/components/PinLock';
import { renderWithDom, testingLibrary } from './dom-test-helpers';

test('PinLock calls onSuccess after valid PIN submission', { concurrency: false }, async () => {
  const authModule = await import('../../src/shared/auth');
  const originalVerifyPinApi = authModule.verifyPinApi;

  authModule.verifyPinApi = async (pin: string) => ({ valid: pin === '123456' });

  let successCount = 0;
  try {
    const { fireEvent, waitFor } = testingLibrary();
    const view = renderWithDom(React.createElement(PinLock, { onSuccess: () => { successCount += 1; } }));

    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      fireEvent.click(view.getByRole('button', { name: digit }));
    }

    fireEvent.submit(view.getByRole('button', { name: '6' }).closest('form') as HTMLFormElement);

    await waitFor(() => {
      assert.equal(successCount, 1);
    });
  } finally {
    authModule.verifyPinApi = originalVerifyPinApi;
  }
});

test('PinLock shows error after invalid PIN submission', { concurrency: false }, async () => {
  const authModule = await import('../../src/shared/auth');
  const originalVerifyPinApi = authModule.verifyPinApi;

  authModule.verifyPinApi = async () => ({ valid: false });

  try {
    const { fireEvent, waitFor } = testingLibrary();
    const view = renderWithDom(React.createElement(PinLock, { onSuccess: () => undefined }));

    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      fireEvent.click(view.getByRole('button', { name: digit }));
    }

    fireEvent.submit(view.getByRole('button', { name: '6' }).closest('form') as HTMLFormElement);

    await waitFor(() => {
      assert.equal(view.getByText('PIN 码不正确').textContent, 'PIN 码不正确');
    });
  } finally {
    authModule.verifyPinApi = originalVerifyPinApi;
  }
});
