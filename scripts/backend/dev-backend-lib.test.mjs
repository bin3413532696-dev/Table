import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRepoEnv, parseDatabaseTarget, parseEnvFile } from './dev-backend-lib.mjs';

test('parseEnvFile ignores comments and keeps later keys', () => {
  const parsed = parseEnvFile(`
# comment
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/table_dev
TABLE_POSTGRES_SERVICE=postgresql-x64-18
`);

  assert.equal(parsed.DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:5432/table_dev');
  assert.equal(parsed.TABLE_POSTGRES_SERVICE, 'postgresql-x64-18');
});

test('loadRepoEnv gives python-backend env higher precedence than repo root', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'table-backend-dev-'));
  fs.writeFileSync(path.join(repoRoot, '.env'), 'DATABASE_URL=postgresql://root@127.0.0.1:5432/root\n');
  fs.mkdirSync(path.join(repoRoot, 'python-backend'));
  fs.writeFileSync(
    path.join(repoRoot, 'python-backend', '.env'),
    'DATABASE_URL=postgresql://service@127.0.0.1:5432/service\n',
  );

  const loaded = loadRepoEnv(repoRoot);
  assert.equal(loaded.DATABASE_URL, 'postgresql://service@127.0.0.1:5432/service');
});

test('parseDatabaseTarget detects local postgres endpoints', () => {
  assert.deepEqual(parseDatabaseTarget('postgresql://postgres:pwd@127.0.0.1:5432/table_dev'), {
    host: '127.0.0.1',
    port: 5432,
    isLocal: true,
  });
  assert.equal(parseDatabaseTarget('mysql://root@127.0.0.1:3306/test'), null);
});
