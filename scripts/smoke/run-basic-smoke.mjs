import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadRepoEnv, parseDatabaseTarget } from '../backend/dev-backend-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const backendOrigin = process.env.SMOKE_BACKEND_ORIGIN || 'http://127.0.0.1:8787';

function mergeEnv() {
  const repoEnv = loadRepoEnv(repoRoot);
  return {
    ...repoEnv,
    ...process.env,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveCommand(command) {
  if (process.platform !== 'win32') {
    return command;
  }

  return command;
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
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function ensureLocalPostgres(env) {
  const target = parseDatabaseTarget(env.DATABASE_URL);
  if (!target?.isLocal) {
    return;
  }

  if (await canConnect(target.host, target.port)) {
    return;
  }

  if (process.platform !== 'win32') {
    throw new Error(`PostgreSQL is not reachable at ${target.host}:${target.port}.`);
  }

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
    throw new Error('Automatic PostgreSQL startup failed.');
  }

  if (!(await waitForDatabase(target.host, target.port))) {
    throw new Error(`PostgreSQL did not become reachable at ${target.host}:${target.port}.`);
  }
}

async function waitForHealthyBackend(child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('Backend exited before smoke health check succeeded.');
    }

    try {
      const response = await fetch(`${backendOrigin}/api/health`);
      if (response.ok) {
        const payload = await response.json();
        if (payload?.status === 'healthy') {
          return;
        }
      }
    } catch {
      // keep polling until timeout
    }

    await wait(1000);
  }

  throw new Error('Backend did not become healthy within 30 seconds.');
}

async function isBackendHealthy() {
  try {
    const response = await fetch(`${backendOrigin}/api/health`);
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    return payload?.status === 'healthy';
  } catch {
    return false;
  }
}

function startBackend(env) {
  return spawn(
    resolveCommand('uv'),
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
    ],
    {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
}

async function main() {
  const env = mergeEnv();
  env.ALLOW_DEFAULT_USER_FALLBACK = env.ALLOW_DEFAULT_USER_FALLBACK || 'true';

  await ensureLocalPostgres(env);

  let backend = null;

  if (!(await isBackendHealthy())) {
    backend = startBackend(env);
  }

  const stopBackend = () => {
    if (backend && backend.exitCode === null) {
      backend.kill('SIGTERM');
    }
  };

  process.once('SIGINT', stopBackend);
  process.once('SIGTERM', stopBackend);

  try {
    if (backend) {
      await waitForHealthyBackend(backend);
    }
    const result = await run('npm', ['run', 'modules:smoke'], { env });
    if (result.signal) {
      process.kill(process.pid, result.signal);
    }
    process.exit(result.code ?? 0);
  } finally {
    stopBackend();
  }
}

await main();
