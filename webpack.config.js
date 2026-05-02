const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

// ─────────────────────────────────────────────────────────────
// data 目录规范:
//
// data/
// ├── config.json          # 全局配置（主题、语言等）
// ├── finance/
// │   └── finance.json      # 财务记录数组
// ├── tasks/
// │   └── tasks.json        # 任务记录数组
// ├── notes/
// │   ├── index.json        # 笔记索引（元数据）
// │   └── *.md              # 笔记文件（Markdown + YAML frontmatter）
// ├── folders/
// │   └── folders.json      # 文件夹结构
// └── backup/
//     └── *.json            # 备份文件（按日期）
// ─────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');

// 确保目录结构存在
function ensureDataDirs() {
  const dirs = ['tasks', 'finance', 'notes', 'folders', 'backup'];
  dirs.forEach(d => {
    const dirPath = path.join(DATA_DIR, d);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
}

// 清理文件名
function sanitizeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim() || 'untitled';
}

// ── 写入数据到文件 ─────────────────────────────────────────

function writeSyncData(data) {
  ensureDataDirs();

  // 1. 任务 → JSON
  if (Array.isArray(data.tasks)) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'tasks', 'tasks.json'),
      JSON.stringify(data.tasks, null, 2),
      'utf-8'
    );
  }

  // 2. 财务 → JSON
  if (Array.isArray(data.finance)) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'finance', 'finance.json'),
      JSON.stringify(data.finance, null, 2),
      'utf-8'
    );
  }

  // 3. 知识库笔记 → Markdown 文件 + 索引
  if (Array.isArray(data.notes)) {
    // 写入索引文件
    const indexData = data.notes.map(note => ({
      id: note.id,
      title: note.title,
      tags: note.tags,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }));
    fs.writeFileSync(
      path.join(DATA_DIR, 'notes', 'index.json'),
      JSON.stringify(indexData, null, 2),
      'utf-8'
    );

    }

  // 4. 文件夹结构
  if (Array.isArray(data.folders)) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'folders', 'folders.json'),
      JSON.stringify(data.folders, null, 2),
      'utf-8'
    );
  }
}

// ── 从文件读取数据 ─────────────────────────────────────────

function readSyncData() {
  ensureDataDirs();

  const result = {
    tasks: [],
    finance: [],
    folders: [],
    config: {},
  };

  // 读取任务
  try {
    const tasksPath = path.join(DATA_DIR, 'tasks', 'tasks.json');
    if (fs.existsSync(tasksPath)) {
      result.tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('[Data] Failed to read tasks:', e.message);
  }

  // 读取财务
  try {
    const financePath = path.join(DATA_DIR, 'finance', 'finance.json');
    if (fs.existsSync(financePath)) {
      result.finance = JSON.parse(fs.readFileSync(financePath, 'utf-8'));
    }
  } catch (e) {
    console.warn('[Data] Failed to read finance:', e.message);
  }

  // 读取文件夹
  try {
    const foldersPath = path.join(DATA_DIR, 'folders', 'folders.json');
    if (fs.existsSync(foldersPath)) {
      result.folders = JSON.parse(fs.readFileSync(foldersPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('[Data] Failed to read folders:', e.message);
  }

  // 读取全局配置
  try {
    const configPath = path.join(DATA_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      result.config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('[Data] Failed to read config:', e.message);
  }

  return result;
}



// 解析数组值 [\"a\", \"b\"]
function parseArrayValue(value) {
  try {
    const match = value.match(/^\[(.*)\]$/);
    if (!match) return [];
    return match[1]
      .split(',')
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(s => s);
  } catch {
    return [];
  }
}

// ── 文件监听 ───────────────────────────────────────────────

let fileWatchers = [];
let lastReloadTime = 0;

function startFileWatching(devServer) {
  const chokidar = require('chokidar');

  const watcher = chokidar.watch(DATA_DIR, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on('all', (event, filePath) => {
    const now = Date.now();
    // 防抖：500ms 内不重复触发
    if (now - lastReloadTime < 500) return;
    lastReloadTime = now;

    console.log(`[Data] File changed: ${event} ${path.relative(DATA_DIR, filePath)}`);

    // 通知客户端数据已更新
    devServer.io?.emit('data-changed', {
      type: path.basename(path.dirname(filePath)),
      file: path.basename(filePath),
      timestamp: now,
    });
  });

  fileWatchers.push(watcher);
  console.log('[Data] File watching started');
}

// ── Webpack 配置 ───────────────────────────────────────────

module.exports = (env, argv) => {
  const isDev = argv.mode !== 'production';

  return {
    mode: isDev ? 'development' : 'production',
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js',
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx|js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-react', { runtime: 'automatic', development: isDev }],
                '@babel/preset-env',
                '@babel/preset-typescript',
              ],
            },
          },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      alias: {
        '@huggingface/transformers': path.resolve(__dirname, 'node_modules/@huggingface/transformers/dist/transformers.web.js'),
        'sharp$': false,
        'onnxruntime-node$': false,
        'onnxruntime-web$': false,
      },
      fallback: {
        fs: false,
        path: false,
        url: false,
      },
    },
    devServer: {
      port: 3266,
      allowedHosts: 'all',
      historyApiFallback: {
        index: '/index.html',
        rewrites: [
          { from: /^\/_p\/\d+\//, to: '/index.html' },
        ],
        disableDotRule: true,
      },

      setupMiddlewares(middlewares, devServer) {
        const app = devServer.app;

        // API: 同步数据到文件
        app.post('/api/sync-data', (req, res, next) => {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              writeSyncData(data);
              res.json({ success: true, timestamp: Date.now() });
            } catch (err) {
              res.status(500).json({ success: false, error: err.message });
            }
          });
        });

        // API: 从文件加载数据
        app.get('/api/load-data', (req, res, next) => {
          try {
            const data = readSyncData();
            res.json({ success: true, data, timestamp: Date.now() });
          } catch (err) {
            res.status(500).json({ success: false, error: err.message });
          }
        });

        

        // 启动文件监听
        try {
          startFileWatching(devServer);
        } catch (err) {
          console.warn('[Data] File watching not available:', err.message);
          console.warn('[Data] Install chokidar: npm install chokidar --save-dev');
        }

        return middlewares;
      },
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './index.html',
        inject: false,
      }),
    ],
  };
};