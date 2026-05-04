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
// └── backup/
//     └── *.json            # 备份文件（按日期）
// ─────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');

// 确保目录结构存在
function ensureDataDirs() {
  const dirs = ['tasks', 'finance', 'backup', 'knowledge'];
  dirs.forEach(d => {
    const dirPath = path.join(DATA_DIR, d);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
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

  // 2. 务 → JSON
  if (Array.isArray(data.finance)) {
    fs.writeFileSync(
      path.join(DATA_DIR, 'finance', 'finance.json'),
      JSON.stringify(data.finance, null, 2),
      'utf-8'
    );
  }

  if (data.knowledge && typeof data.knowledge === 'object') {
    const knowledgeDir = path.join(DATA_DIR, 'knowledge');
    const knowledge = data.knowledge;

    const writeJsonFile = (filename, payload) => {
      if (payload === undefined) {
        return;
      }

      fs.writeFileSync(
        path.join(knowledgeDir, filename),
        JSON.stringify(payload, null, 2),
        'utf-8'
      );
    };

    writeJsonFile('context.jsonld', knowledge.context);
    writeJsonFile('ontology.jsonld', knowledge.ontology);
    writeJsonFile('entities.jsonld', knowledge.entities);
    writeJsonFile('documents.jsonld', knowledge.documents);
    writeJsonFile('assertions.jsonld', knowledge.assertions);
  }
}

// ── 从文件读取数据 ─────────────────────────────────────────

function readSyncData() {
  ensureDataDirs();

  const result = {
    tasks: [],
    finance: [],
    config: {},
    knowledge: {
      context: {},
      ontology: {
        classes: [],
        relations: [],
      },
      entities: [],
      documents: [],
      assertions: [],
      updatedAt: 0,
    },
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

  // 读取全局配置
  try {
    const configPath = path.join(DATA_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      result.config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('[Data] Failed to read config:', e.message);
  }

  try {
    const knowledgeDir = path.join(DATA_DIR, 'knowledge');
    const readJsonFile = (filename, fallback) => {
      const filePath = path.join(knowledgeDir, filename);
      if (!fs.existsSync(filePath)) {
        return fallback;
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    };

    result.knowledge = {
      context: readJsonFile('context.jsonld', {}),
      ontology: readJsonFile('ontology.jsonld', { classes: [], relations: [] }),
      entities: readJsonFile('entities.jsonld', []),
      documents: readJsonFile('documents.jsonld', []),
      assertions: readJsonFile('assertions.jsonld', []),
      updatedAt: Date.now(),
    };
  } catch (e) {
    console.warn('[Data] Failed to read knowledge:', e.message);
  }

  return result;
}

function readKnowledgeFileDebugInfo() {
  ensureDataDirs();

  const knowledgeDir = path.join(DATA_DIR, 'knowledge');
  const files = [
    'context.jsonld',
    'ontology.jsonld',
    'entities.jsonld',
    'documents.jsonld',
    'assertions.jsonld',
  ];

  return files.map((filename) => {
    const filePath = path.join(knowledgeDir, filename);
    const exists = fs.existsSync(filePath);

    if (!exists) {
      return {
        filename,
        exists: false,
        size: 0,
        mtimeMs: 0,
        itemCount: null,
      };
    }

    const stat = fs.statSync(filePath);
    let itemCount = null;

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(parsed)) {
        itemCount = parsed.length;
      } else if (parsed && typeof parsed === 'object') {
        itemCount = Object.keys(parsed).length;
      }
    } catch (error) {
      itemCount = -1;
    }

    return {
      filename,
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      itemCount,
    };
  });
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
      filename: isDev ? 'bundle.js' : '[name].[contenthash:8].js',
      chunkFilename: isDev ? '[name].bundle.js' : '[name].[contenthash:8].bundle.js',
      clean: true,
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

        app.get('/api/debug/knowledge-files', (req, res, next) => {
          try {
            const files = readKnowledgeFileDebugInfo();
            res.json({ success: true, files, timestamp: Date.now() });
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
    optimization: {
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          reactVendor: {
            test: /[\\/]node_modules[\\/](react|react-dom|react-router-dom|scheduler)[\\/]/,
            name: 'react-vendor',
            priority: 30,
          },
          chartVendor: {
            test: /[\\/]node_modules[\\/](recharts|d3)[\\/]/,
            name: 'chart-vendor',
            priority: 25,
          },
          animationVendor: {
            test: /[\\/]node_modules[\\/]framer-motion[\\/]/,
            name: 'animation-vendor',
            priority: 20,
          },
          miscVendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendor',
            priority: 10,
          },
        },
      },
      runtimeChunk: 'single',
    },
  };
};
