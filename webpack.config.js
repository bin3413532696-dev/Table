const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

// ── 同步 data 目录的写入逻辑 ──
const DATA_DIR = path.join(__dirname, 'data');

function sanitizeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim() || 'untitled';
}

function writeSyncData(data) {
  // 确保目录存在
  const dirs = ['tasks', 'finance'].map(d => path.join(DATA_DIR, d));
  dirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

  // 1. 任务 → JSON
  if (Array.isArray(data.tasks)) {
    fs.writeFileSync(path.join(DATA_DIR, 'tasks', 'tasks.json'), JSON.stringify(data.tasks, null, 2), 'utf-8');
  }

  // 2. 财务 → JSON
  if (Array.isArray(data.finance)) {
    fs.writeFileSync(path.join(DATA_DIR, 'finance', 'finance.json'), JSON.stringify(data.finance, null, 2), 'utf-8');
  }
}

module.exports = (env, argv) => {
  const isDev = argv.mode !== 'production';

  return {
    mode: isDev ? 'development' : 'production',
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js'
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
                [
                  '@babel/preset-react',
                  {
                    runtime: 'automatic',
                    development: isDev
                  }
                ],
                '@babel/preset-env',
                '@babel/preset-typescript'
              ]
            }
          }
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader']
        }
      ]
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
      }
    },
    devServer: {
      port: 3266,
      allowedHosts: 'all',
      historyApiFallback: {
        index: '/index.html',
        rewrites: [
          { from: /^\/_p\/\d+\//, to: '/index.html' }
        ]
      },
      
      setupMiddlewares(middlewares, devServer) {
        // API: 接收数据同步请求，写入 data/ 目录
        devServer.app.post('/api/sync-data', (req, res) => {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              writeSyncData(data);
              res.json({ success: true });
            } catch (err) {
              res.status(500).json({ success: false, error: err.message });
            }
          });
        });
        return middlewares;
      }
    },
plugins: [
      new HtmlWebpackPlugin({
        template: './index.html',
        inject: 'body'
      })
    ]
  };
};
