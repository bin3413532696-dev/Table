const { spawn } = require('child_process');
const path = require('path');
const chokidar = require('chokidar');

const projectRoot = path.resolve(__dirname, '..');
const tscBin = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const compiledEntry = path.join(projectRoot, 'dist-server', 'src', 'index.js');

let serverProcess = null;
let rebuildTimer = null;
let isShuttingDown = false;

function runTsc() {
  return new Promise((resolve, reject) => {
    const compiler = spawn(process.execPath, [tscBin, '-p', 'tsconfig.server.json'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env,
    });

    compiler.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`TypeScript build failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    const current = serverProcess;
    serverProcess = null;

    current.once('exit', () => resolve());
    current.kill();
  });
}

function startServer() {
  serverProcess = spawn(process.execPath, [compiledEntry], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });

  serverProcess.on('exit', (code) => {
    if (isShuttingDown) {
      return;
    }

    if (code && code !== 0) {
      console.error(`Server exited with code ${code}`);
    }
  });
}

async function rebuildAndRestart() {
  try {
    await runTsc();
    await stopServer();
    startServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
}

function scheduleRebuild() {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }

  rebuildTimer = setTimeout(() => {
    void rebuildAndRestart();
  }, 150);
}

async function bootstrap() {
  await rebuildAndRestart();

  const watcher = chokidar.watch(path.join(projectRoot, 'server'), {
    ignoreInitial: true,
  });

  watcher.on('add', scheduleRebuild);
  watcher.on('change', scheduleRebuild);
  watcher.on('unlink', scheduleRebuild);

  const shutdown = async () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    await watcher.close();
    await stopServer();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void bootstrap();
