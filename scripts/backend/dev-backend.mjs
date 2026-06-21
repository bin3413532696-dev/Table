import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadRepoEnv, parseDatabaseTarget } from './dev-backend-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function mergeEnv() {
  const repoEnv = loadRepoEnv(repoRoot);
  return { ...repoEnv, ...process.env };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForDatabase(host, port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) {
      return true;
    }
    await wait(1000);
  }
  return false;
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function ensureLocalPostgres(env, target) {
  if (!target?.isLocal) {
    return;
  }

  if (await canConnect(target.host, target.port)) {
    return;
  }

  if (process.platform !== 'win32') {
    console.error(
      `[backend:dev] PostgreSQL is not reachable at ${target.host}:${target.port}. Start the local database first.`,
    );
    process.exit(1);
  }

  console.log(
    `[backend:dev] PostgreSQL is not reachable at ${target.host}:${target.port}. Attempting local startup...`,
  );

  const scriptPath = path.join(repoRoot, 'scripts', 'backend', 'ensure-local-postgres.ps1');
  const result = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-HostName',
      target.host,
      '-Port',
      String(target.port),
    ],
    { env },
  );

  if (result.code !== 0) {
    console.error('[backend:dev] Automatic PostgreSQL startup failed.');
    process.exit(result.code ?? 1);
  }

  if (!(await waitForDatabase(target.host, target.port))) {
    console.error(
      `[backend:dev] PostgreSQL still did not become reachable at ${target.host}:${target.port}.`,
    );
    process.exit(1);
  }
}

async function main() {
  const env = mergeEnv();
  const target = parseDatabaseTarget(env.DATABASE_URL);
  await ensureLocalPostgres(env, target);

  const result = await run(
    'uv',
    [
      'run',
      '--default-index',
      'https://pypi.org/simple',
      '--package',
      'table-python-backend',
      'uvicorn',
      'app.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      '8787',
      '--reload',
    ],
    { env, shell: process.platform === 'win32' },
  );

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  process.exit(result.code ?? 0);
}

await main();
