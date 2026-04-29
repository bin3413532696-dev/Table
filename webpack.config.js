const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// ── 同步 data 目录的写入逻辑 ──
const DATA_DIR = path.join(__dirname, 'data');

function sanitizeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim() || 'untitled';
}

function writeSyncData(data) {
  // 确保目录存在
  const dirs = ['notes', 'tasks', 'finance', 'folders'].map(d => path.join(DATA_DIR, d));
  dirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

  // 1. 笔记 → .md 文件（按文件夹分组）
  if (Array.isArray(data.notes)) {
    // 清空 notes 目录下所有内容
    const notesDir = path.join(DATA_DIR, 'notes');
    if (fs.existsSync(notesDir)) {
      fs.readdirSync(notesDir).forEach(entry => {
        const entryPath = path.join(notesDir, entry);
        if (fs.statSync(entryPath).isDirectory()) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(entryPath);
        }
      });
    }

    // 建立文件夹映射
    const folderMap = {};
    if (Array.isArray(data.folders)) {
      data.folders.forEach(f => { folderMap[f.id] = f.name; });
    }

    data.notes.forEach(note => {
      let noteDir = notesDir;
      if (note.folderId && folderMap[note.folderId]) {
        const folderName = sanitizeFileName(folderMap[note.folderId]);
        noteDir = path.join(notesDir, folderName);
        if (!fs.existsSync(noteDir)) fs.mkdirSync(noteDir, { recursive: true });
      }

      const tags = note.tags?.length
        ? `tags: [${note.tags.map(t => `"${t}"`).join(', ')}]`
        : 'tags: []';

      const frontMatter = `---
title: "${note.title || '未命名'}"
created: ${note.createdAt || ''}
updated: ${note.updatedAt || ''}
${tags}
---

`;

      const content = frontMatter + (note.content || '');
      const fileName = sanitizeFileName(note.title || '未命名') + '.md';
      fs.writeFileSync(path.join(noteDir, fileName), content, 'utf-8');
    });
  }

  // 2. 任务 → JSON
  if (Array.isArray(data.tasks)) {
    fs.writeFileSync(path.join(DATA_DIR, 'tasks', 'tasks.json'), JSON.stringify(data.tasks, null, 2), 'utf-8');
  }

  // 3. 财务 → JSON
  if (Array.isArray(data.finance)) {
    fs.writeFileSync(path.join(DATA_DIR, 'finance', 'finance.json'), JSON.stringify(data.finance, null, 2), 'utf-8');
  }

  // 4. 文件夹 → JSON
  if (Array.isArray(data.folders)) {
    fs.writeFileSync(path.join(DATA_DIR, 'folders', 'folders.json'), JSON.stringify(data.folders, null, 2), 'utf-8');
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
      extensions: ['.ts', '.tsx', '.js', '.jsx']
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
