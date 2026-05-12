import test from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'zod';

import { updateFinanceRecordSchema } from '../src/modules/finance/schema';
import { updateTaskSchema } from '../src/modules/tasks/schema';
import { ensureMutationResult } from '../src/shared/conflict';

test('finance update schema requires version', () => {
  assert.throws(
    () => updateFinanceRecordSchema.parse({ amount: 10 }),
    (error) => error instanceof ZodError && error.issues.some((issue) => issue.path.join('.') === 'version')
  );

  const payload = updateFinanceRecordSchema.parse({ amount: 10, version: 1 });
  assert.equal(payload.version, 1);
});

test('task update schema requires version', () => {
  assert.throws(
    () => updateTaskSchema.parse({ completed: true }),
    (error) => error instanceof ZodError && error.issues.some((issue) => issue.path.join('.') === 'version')
  );

  const payload = updateTaskSchema.parse({ completed: true, version: 2 });
  assert.equal(payload.version, 2);
});

test('ensureMutationResult returns null when entity does not exist', () => {
  const result = ensureMutationResult(null, null, 'conflict');
  assert.equal(result, null);
});

test('ensureMutationResult throws a 409-style error when mutation lost the race', () => {
  assert.throws(
    () => ensureMutationResult({ id: 'exists' }, null, 'race detected'),
    (error) =>
      error instanceof Error &&
      'statusCode' in error &&
      error.statusCode === 409 &&
      error.message === 'race detected'
  );
});

test('ensureMutationResult returns repository result when mutation succeeds', () => {
  const updated = { id: 'updated', version: 2 };
  const result = ensureMutationResult({ id: 'existing', version: 1 }, updated, 'conflict');
  assert.deepEqual(result, updated);
});
