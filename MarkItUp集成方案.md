# MarkItUp PKM 集成到 personal-workspace 技术方案

> 文档版本：v1.0.0
> 创建日期：2026-05-01
> 作者：Sisyphus
> 状态：待用户确认

---

## 一、架构分析

### 1.1 当前项目技术栈

| 组件 | 技术 |
|------|------|
| 框架 | React 18 + Webpack |
| 路由 | React Router v6 |
| 样式 | Tailwind CSS |
| 状态 | Zustand |
| 存储 | IndexedDB (Dexie.js) |
| 认证 | PinLock 组件 |

### 1.2 MarkItUp PKM 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Next.js 16 (Pages Router) |
| 编辑器 | TipTap (ProseMirror) |
| 实时协作 | Socket.IO + WebSocket |
| 认证 | JWT + cookie |
| AI | OpenAI / Anthropic / Gemini / Ollama |
| 向量 | Transformers.js (浏览器内) |
| 存储 | IndexedDB + SQLite |

### 1.3 架构决策

**两种集成路径：**

| 方案 | 描述 | 复杂度 | 优点 | 缺点 |
|------|------|--------|------|------|
| **A: iFrame 嵌入** | 将 MarkItUp 作为独立应用嵌入 | ⭐ 低 | 隔离部署、无技术冲突 | 体验割裂、跨域通信 |
| **B: 功能移植** | 抽取 MarkItUp 核心组件集成到当前项目 | ⭐⭐⭐ 高 | 体验一致、统一界面 | 改动大、依赖冲突 |

**推荐：方案 A（iFrame 嵌入）**

理由：
1. MarkItUp 依赖过多（Next.js、Socket.IO、JWT），强行移植破坏当前架构
2. iFrame 隔离可以独立升级维护
3. 当前项目作为"工作台"，MarkItUp 作为"知识库"，职责清晰
4. 可快速验证，保留未来移植可能性

---

## 二、iFrame 嵌入方案（推荐）

### 2.1 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                  personal-workspace (Host)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Dashboard  │  │   Tasks     │  │   Knowledge Base    │ │
│  │             │  │             │  │   (MarkItUp iFrame) │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  MarkItUp Container                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  MarkItUp App (独立部署，独立端口)                    │   │
│  │  - 独立 JWT 认证                                     │   │
│  │  - 独立数据库                                        │   │
│  │  - Ollama AI (本地)                                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 部署模式

#### 模式 1：Docker 独立部署（推荐生产环境）

```bash
# 启动 MarkItUp 容器
docker run -d \
  --name markitup \
  -p 3001:3000 \
  -e JWT_SECRET=$(openssl rand -base64 32) \
  -e ENCRYPTION_KEY=$(openssl rand -hex 16) \
  -e DISABLE_AUTH=true \
  ghcr.io/xclusive36/markitup:latest
```

#### 模式 2：与当前项目同仓库开发

```
personal-workspace/
├── src/
│   └── pages/
│       └── Knowledge/  ← MarkItUp 作为 Next.js 子模块
├── markitup-pkm/      ← MarkItUp 克隆到此目录
│   ├── src/
│   ├── pages/
│   └── ...
└── docker-compose.yml
```

### 2.3 路由设计

```typescript
// App.tsx
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Loading from './components/Loading';

// 现有页面
import Dashboard from './pages/Dashboard';
import Finance from './pages/Finance';
import Tasks from './pages/Tasks';
import Tools from './pages/Tools';
import Settings from './pages/Settings';

// 知识库页面
const Knowledge = lazy(() => import('./pages/Knowledge'));

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/finance" element={<Finance />} />
      <Route path="/tasks" element={<Tasks />} />
      <Route path="/tools" element={<Tools />} />
      <Route path="/settings" element={<Settings />} />
      <Route
        path="/knowledge/*"
        element={
          <Suspense fallback={<Loading />}>
            <Knowledge />
          </Suspense>
        }
      />
    </Routes>
  );
}

export default App;
```

### 2.4 知识库页面组件

```typescript
// src/pages/Knowledge/index.tsx

import { useEffect, useCallback } from 'react';
import { BookOpen, Search, Plus } from 'lucide-react';

interface KnowledgeMessage {
  type: 'navigate' | 'search' | 'create-note' | 'auth-status';
  payload?: any;
}

const getMarkItUpUrl = () => {
  const isDev = process.env.NODE_ENV === 'development';
  return isDev
    ? 'http://localhost:3001'
    : 'https://knowledge.your-domain.com';
};

const Knowledge = () => {
  // 向 MarkItUp 发送消息
  const sendToMarkItUp = useCallback((message: KnowledgeMessage) => {
    const iframe = document.getElementById('markitup-iframe') as HTMLIFrameElement;
    iframe?.contentWindow?.postMessage(message, '*');
  }, []);

  // 接收 MarkItUp 消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent<KnowledgeMessage>) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'auth-status':
          console.log('MarkItUp auth:', payload);
          break;
        case 'note-created':
          // 处理笔记创建事件
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <span className="font-medium">知识库</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => sendToMarkItUp({ type: 'search' })}
          >
            <Search className="w-4 h-4" />
            搜索
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => sendToMarkItUp({ type: 'create-note' })}
          >
            <Plus className="w-4 h-4" />
            新建笔记
          </button>
        </div>
      </div>

      {/* iFrame Container */}
      <iframe
        id="markitup-iframe"
        src={getMarkItUpUrl()}
        style={{ width: '100%', height: 'calc(100% - 45px)', border: 'none' }}
        allow="clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
};

export default Knowledge;
```

### 2.5 侧边栏导航更新

```typescript
// src/components/Layout/Sidebar.tsx
// 添加知识库入口

const navItems = [
  { path: '/', icon: LayoutDashboard, label: '工作台' },
  { path: '/finance', icon: Wallet, label: '财务' },
  { path: '/tasks', icon: CheckSquare, label: '任务' },
  { path: '/knowledge', icon: BookOpen, label: '知识库' },  // 新增
  { path: '/tools', icon: Wrench, label: '工具' },
  { path: '/settings', icon: Settings, label: '设置' },
];
```

---

## 三、功能移植方案（长期）

### 3.1 依赖冲突分析

| MarkItUp 依赖 | 当前项目 | 冲突 | 解决方案 |
|--------------|----------|------|----------|
| next 16.x | ❌ 无 | ❌ | 需要 Next.js 子应用 |
| tiptap | ❌ 无 | ✅ | 可安装 |
| socket.io-client | ❌ 无 | ✅ | 可安装 |
| transformers.js | ❌ 无 | ✅ | 可安装 |
| @tanstack/react-query | ❌ 无 | ✅ | 可安装 |
| zustand | ✅ 有 | ✅ | 需版本对齐 |

### 3.2 核心组件抽取

```
markitup-pkm/src/
├── components/
│   ├── Editor/           # TipTap 编辑器核心
│   │   ├── Editor.tsx
│   │   ├── extensions/   # ProseMirror 扩展
│   │   └── plugins/
│   ├── AI/               # AI 功能
│   │   ├── ChatPanel.tsx
│   │   ├── LinkSuggester.tsx
│   │   └── providers/
│   ├── Graph/            # 知识图谱
│   │   └── GraphView.tsx
│   └── Search/          # 搜索（含语义搜索）
│       ├── SearchModal.tsx
│       └── SemanticSearch.tsx
├── hooks/
│   ├── useAI.ts
│   ├── useSemanticSearch.ts
│   └── useWikilinks.ts
└── lib/
    ├── embeddings.ts     # Transformers.js 向量
    └── ollama.ts        # Ollama 客户端
```

### 3.3 集成步骤

#### Phase 1: 编辑器集成

```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-wikilink
```

```typescript
// src/components/RichEditor.tsx

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Wikilink from '@tiptap/extension-wikilink';

interface RichEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
}

export const RichEditor = ({ content, onChange, placeholder }: RichEditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Wikilink.configure({
        HTMLAttributes: {
          class: 'wikilink',
        },
      }),
    ],
    content,
    placeholder,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  return (
    <div className="rich-editor">
      <EditorContent editor={editor} />
    </div>
  );
};
```

#### Phase 2: 向量搜索集成

```bash
npm install @xenova/transformers
```

```typescript
// src/lib/semanticSearch.ts

import { pipeline, env } from '@xenova/transformers';

// 配置本地模型路径
env.localModelPath = '/models/';

interface Embedder {
  initialize: () => Promise<void>;
  embed: (text: string) => Promise<Float32Array>;
}

class LocalEmbedder implements Embedder {
  private extractor: any = null;

  async initialize(): Promise<void> {
    if (this.extractor) return;
    console.log('Loading embedding model...');
    this.extractor = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { revision: 'fp16' }
    );
    console.log('Model loaded.');
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) await this.initialize();
    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    return output.data;
  }
}

export const embedder = new LocalEmbedder();

// 向量相似度计算
export const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

// 语义搜索
export const semanticSearch = async (
  query: string,
  documents: Array<{ id: string; content: string }>,
  topK: number = 5
): Promise<Array<{ id: string; score: number }>> => {
  const queryEmbedding = await embedder.embed(query);

  const scores = await Promise.all(
    documents.map(async (doc) => {
      const docEmbedding = await embedder.embed(doc.content);
      return {
        id: doc.id,
        score: cosineSimilarity(queryEmbedding, docEmbedding),
      };
    })
  );

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
};
```

#### Phase 3: Ollama 集成

```bash
npm install ollama
```

```typescript
// src/lib/ollama.ts

import ollama from 'ollama';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatOptions {
  model: string;
  messages: Message[];
  stream?: boolean;
}

export const chat = async (
  options: ChatOptions
): Promise<AsyncIterable<ollama.ChatResponse>> => {
  const response = await ollama.chat({
    model: options.model,
    messages: options.messages,
    stream: options.stream ?? true,
  });

  return response;
};

// 流式聊天
export const streamChat = async (
  model: string,
  messages: Message[],
  onChunk: (content: string) => void
): Promise<void> => {
  const response = await ollama.chat({
    model,
    messages,
    stream: true,
  });

  for await (const part of response) {
    onChunk(part.message.content);
  }
};
```

---

## 四、AI 功能详细设计

### 4.1 多 Provider 支持

```typescript
// src/lib/ai/providers.ts

type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama';

interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Provider 实现
const providers = {
  openai: {
    async chat(messages: ChatMessage[], config: AIConfig) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
        }),
      });
      return response.json();
    },
  },

  anthropic: {
    async chat(messages: ChatMessage[], config: AIConfig) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          max_tokens: 1024,
          stream: true,
        }),
      });
      return response.json();
    },
  },

  gemini: {
    async chat(messages: ChatMessage[], config: AIConfig) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          }),
        }
      );
      return response.json();
    },
  },

  ollama: {
    async chat(messages: ChatMessage[], config: AIConfig) {
      const baseUrl = config.baseUrl || 'http://localhost:11434';
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
        }),
      });
      return response.json();
    },
  },
};

// 统一接口
export const aiChat = async (
  messages: ChatMessage[],
  config: AIConfig
): Promise<any> => {
  return providers[config.provider].chat(messages, config);
};
```

### 4.2 语义搜索流程

```
用户查询 "project ideas"
           │
           ▼
┌─────────────────────────┐
│  1. BM25 关键词搜索      │  ← Fuse.js 全文搜索
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  2. Transformers.js     │  ← 生成查询向量
│     embed(query)        │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  3. IndexedDB 向量       │  ← 计算余弦相似度
│     相似度匹配           │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  4. RRF 融合排序         │  ← Reciprocal Rank Fusion
└───────────┬─────────────┘
            │
            ▼
        Top-K 结果
```

### 4.3 Ollama 本地部署

```bash
# 安装 Ollama
# macOS
brew install ollama

# Linux/WSL
curl -fsSL https://ollama.ai/install.sh | sh

# Windows (需要 WSL2)
# 在 WSL2 内运行上述安装命令

# 启动服务（默认端口 11434）
ollama serve

# 下载模型
ollama pull llama3.2          # 主模型（对话）
ollama pull nomic-embed-text   # 向量模型

# 验证安装
ollama list
```

---

## 五、存储设计

### 5.1 IndexedDB Schema

```typescript
// src/db/knowledge.ts

import Dexie, { Table } from 'dexie';

interface Note {
  id: string;
  title: string;
  content: string;
  embedding?: Float32Array;
  tags: string[];
  links: string[];      // 此笔记链接到的其他笔记
  backlinks: string[];  // 链接到此笔记的其他笔记
  createdAt: number;
  updatedAt: number;
}

interface EmbeddingCache {
  noteId: string;
  vector: Float32Array;
  updatedAt: number;
}

interface SearchIndex {
  id: string;
  term: string;
  noteIds: string[];
}

class KnowledgeDB extends Dexie {
  notes!: Table<Note>;
  embeddings!: Table<EmbeddingCache>;
  searchIndex!: Table<SearchIndex>;

  constructor() {
    super('KnowledgeDB');
    this.version(1).stores({
      notes: 'id, title, updatedAt, *tags, *links',
      embeddings: 'noteId, updatedAt',
      searchIndex: 'id, term, *noteIds',
    });
  }
}

export const knowledgeDb = new KnowledgeDB();

// 笔记操作
export const noteOperations = {
  async create(note: Omit<Note, 'id'>): Promise<string> {
    const id = crypto.randomUUID();
    await knowledgeDb.notes.add({ ...note, id });
    await updateSearchIndex(id, note.content);
    return id;
  },

  async update(id: string, updates: Partial<Note>): Promise<void> {
    await knowledgeDb.notes.update(id, { ...updates, updatedAt: Date.now() });
    if (updates.content) {
      await updateSearchIndex(id, updates.content);
    }
  },

  async delete(id: string): Promise<void> {
    await knowledgeDb.transaction('rw', knowledgeDb.notes, knowledgeDb.embeddings, async () => {
      await knowledgeDb.notes.delete(id);
      await knowledgeDb.embeddings.delete(id);
    });
  },

  async getAll(): Promise<Note[]> {
    return knowledgeDb.notes.toArray();
  },
};
```

### 5.2 向量索引策略

```typescript
// 增量索引
export const indexNote = async (note: Note): Promise<void> => {
  try {
    // 生成向量
    const embedding = await embedder.embed(note.content);

    // 事务更新
    await knowledgeDb.transaction('rw', knowledgeDb.notes, knowledgeDb.embeddings, async () => {
      await knowledgeDb.notes.put({ ...note, embedding });
      await knowledgeDb.embeddings.put({
        noteId: note.id,
        vector: embedding,
        updatedAt: Date.now(),
      });
    });
  } catch (error) {
    console.error(`Failed to index note ${note.id}:`, error);
  }
};

// 批量索引（首次导入）
export const indexAllNotes = async (
  notes: Note[],
  onProgress?: (current: number, total: number) => void
): Promise<void> => {
  const total = notes.length;

  for (let i = 0; i < notes.length; i++) {
    await indexNote(notes[i]);
    onProgress?.(i + 1, total);
  }
};

// 更新搜索索引（BM25）
const updateSearchIndex = async (noteId: string, content: string): Promise<void> => {
  const words = content.toLowerCase().split(/\W+/).filter(w => w.length > 2);

  for (const word of words) {
    const existing = await knowledgeDb.searchIndex.get(word);
    if (existing) {
      if (!existing.noteIds.includes(noteId)) {
        await knowledgeDb.searchIndex.update(word, {
          noteIds: [...existing.noteIds, noteId],
        });
      }
    } else {
      await knowledgeDb.searchIndex.add({
        id: word,
        term: word,
        noteIds: [noteId],
      });
    }
  }
};
```

---

## 六、界面效果预览

### 6.1 iFrame 嵌入后的布局

```
┌──────────────────────────────────────────────────────────────────┐
│  Header (60px)                                                   │
├─────────┬────────────────────────────────────────────────────────┤
│         │                                                        │
│ Sidebar │  ┌──────────────────────────────────────────────────┐  │
│  (200px)│  │  Content Area                                    │  │
│         │  │                                                  │  │
│  工作台   │  │  ┌──────────────────────────────────────────┐   │  │
│  财务    │  │  │ 知识库 Header (45px)                      │   │  │
│  任务    │  │  │ [🔍 搜索] [➕ 新建]                       │   │  │
│  知识库 ← ← ←[当前选中，带高亮]                               │   │
│  工具    │  │  └──────────────────────────────────────────┘   │  │
│  设置    │  │  ┌──────────────────────────────────────────┐   │  │
│         │  │  │                                          │   │  │
│         │  │  │   MarkItUp iFrame                        │   │  │
│         │  │  │   (全高，约 calc(100vh - 105px))         │   │  │
│         │  │  │                                          │   │  │
│         │  │  │                                          │   │  │
│         │  │  │                                          │   │  │
│         │  │  └──────────────────────────────────────────┘   │  │
│         │  └──────────────────────────────────────────────────┘  │
└─────────┴────────────────────────────────────────────────────────┘
```

### 6.2 iFrame 方案的视觉问题

| 问题 | 表现 | 严重度 |
|------|------|--------|
| 主题割裂 | MarkItUp 有自己独立的暗色/亮色主题，与外层不统一 | ⚠️ 中 |
| 双滚动条 | 外层 + iFrame 内各有一个滚动条 | ⚠️ 中 |
| 边界感 | iFrame 边框明显，看起来像"网页中的网页" | ⚠️ 低 |
| 认证重复 | 如果主应用有 PinLock，MarkItUp 可能也需要登录 | ⚠️ 高 |
| 体验割裂 | MarkItUp 的侧边栏和编辑器和外层 UI 风格不一致 | ⚠️ 高 |

### 6.3 iFrame 嵌入效果示意

```
┌────────────────────────────────────────────────────────────────┐
│  Header (personal-workspace 主题)                               │
├─────────┬──────────────────────────────────────────────────────┤
│ Sidebar │  知识库页眉（外层样式）                               │
│         │  ┌──────────────────────────────────────────────────┐ │
│         │  │  MarkItUp 内容 (iFrame)                         │ │
│         │  │  ┌────────────────────────────────────────────┐ │ │
│         │  │  │ 侧边栏  │ 编辑器区域                        │ │ │
│         │  │  │        │                                    │ │ │
│         │  │  │ 📁 笔记 │ # 欢迎使用知识库                   │ │ │
│         │  │  │        │                                    │ │ │
│         │  │  │ 🏷️ 标签 │ 这是一个 `[[wikilink]]` 示例      │ │ │
│         │  │  │        │                                    │ │ │
│         │  │  │ 🔍 搜索 │ ## 特性                            │ │ │
│         │  │  │        │ - 🤖 AI 对话                       │ │ │
│         │  │  │        │ - 🔗 双向链接                      │ │ │
│         │  │  │        │ - 🧠 语义搜索                      │ │ │
│         │  │  └────────────────────────────────────────────┘ │ │
│         │  └──────────────────────────────────────────────────┘ │
└─────────┴──────────────────────────────────────────────────────┘

问题：MarkItUp 的侧边栏和编辑器风格与外层不一致，
      看起来像是两个不同的应用拼在一起
```

### 6.4 功能移植方案（推荐长期方案）

完全嵌入后的效果：

```
┌────────────────────────────────────────────────────────────────┐
│  Header (外层主题)                                              │
├─────────┬──────────────────────────────────────────────────────┤
│ Sidebar │  知识库页眉（与 Finance/Tasks 一致的 UI）            │
│         │  ┌──────────────────────────────────────────────────┐ │
│         │  │  工具栏 (与任务列表相同的卡片样式)                │ │
│         │  │  [📝 新建] [🔍 搜索] [🏷️ 标签] [📊 图谱]       │ │
│         │  └──────────────────────────────────────────────────┘ │
│         │  ┌──────────────────────────────────────────────────┐ │
│         │  │                                                   │ │
│         │  │   笔记列表 (与 Finance 记录列表类似)               │ │
│         │  │   ┌────────────────────────────────────────────┐│ │
│         │  │   │ 📄 项目笔记                    2024-01-15   ││ │
│         │  │   │ 这是关于项目管理的笔记...         3 条链接  ││ │
│         │  │   └────────────────────────────────────────────┘│ │
│         │  │   ┌────────────────────────────────────────────┐│ │
│         │  │   │ 📄 AI 研究笔记                  2024-01-14   ││ │
│         │  │   │ 关于 AI 模型集成的思考...       5 条链接   ││ │
│         │  │   └────────────────────────────────────────────┘│ │
│         │  └──────────────────────────────────────────────────┘ │
│         │  ┌──────────────────────────────────────────────────┐ │
│         │  │                                                   │ │
│         │  │   编辑器 (TipTap，与 Finance 表单风格一致)         │ │
│         │  │   ┌────────────────────────────────────────────┐│ │
│         │  │   │ # 笔记标题                                   ││ │
│         │  │   │                                            ││ │
│         │  │   │ 在此输入内容，支持 [[wikilink]]...         ││ │
│         │  │   │                                            ││ │
│         │  │  └────────────────────────────────────────────┘│ │
│         │  └──────────────────────────────────────────────────┘ │
└─────────┴──────────────────────────────────────────────────────┘

优点：体验完全一致，UI 组件复用，主题自动同步
```

### 6.5 方案对比总结

| 方案 | 视觉体验 | 开发成本 | 推荐度 |
|------|----------|----------|--------|
| iFrame | ⭐⭐ 割裂感明显 | ⭐ 低 | ⚠️ 仅快速验证用 |
| 功能嵌入 | ⭐⭐⭐⭐ 完全一致 | ⭐⭐⭐ 高 | ✅ 推荐长期使用 |

---

## 七、UI/UX 集成设计

### 7.1 布局集成

```tsx
// src/pages/Knowledge/components/HeaderBar.tsx

import { Search, Plus, Settings } from 'lucide-react';

interface HeaderBarProps {
  onSearch: () => void;
  onNewNote: () => void;
  onSettings: () => void;
}

export const HeaderBar = ({ onSearch, onNewNote, onSettings }: HeaderBarProps) => {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-primary" />
        <span className="font-medium">知识库</span>
      </div>
      <div className="flex items-center gap-1">
        <button className="btn btn-ghost btn-sm" onClick={onSearch}>
          <Search className="w-4 h-4" />
        </button>
        <button className="btn btn-primary btn-sm" onClick={onNewNote}>
          <Plus className="w-4 h-4" />
          新建
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onSettings}>
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
```

### 6.2 样式覆盖

```css
/* src/styles/markitup-overrides.css */

/* MarkItUp 主题变量适配 */
.markitup-editor {
  --color-primary: var(--primary);
  --color-bg: var(--bg);
  --color-text: var(--text);
  --color-border: var(--border);
}

/* Wikilink 样式 */
.wikilink {
  color: var(--color-primary);
  text-decoration: underline dotted;
  cursor: pointer;
  transition: color 0.2s;
}

.wikilink:hover {
  color: var(--color-primary-hover);
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .markitup-editor {
    --color-bg: var(--bg-dark);
    --color-text: var(--text-dark);
    --color-border: var(--border-dark);
  }
}
```

---

## 八、实施计划

### Phase 1: iFrame 集成（1-2天）

- [ ] Docker 部署 MarkItUp
- [ ] 创建 KnowledgePage 组件
- [ ] 配置跨域通信（PostMessage）
- [ ] 添加路由和导航

### Phase 2: 数据打通（2-3天）

- [ ] 实现笔记双向同步（可选）
- [ ] 配置统一认证（可选）
- [ ] 设计数据边界

### Phase 3: 功能增强（3-5天）

- [ ] Ollama 本地 AI 部署
- [ ] 向量搜索集成
- [ ] 智能链接建议

### Phase 4: 体验优化（2-3天）

- [ ] 样式统一
- [ ] 性能优化
- [ ] 错误处理

---

## 九、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| iFrame 跨域限制 | 中 | 低 | 使用 `postMessage` + 验证 origin |
| MarkItUp 更新导致兼容 | 低 | 中 | 锁定版本、定期同步 |
| 向量搜索性能 | 中 | 中 | 限制笔记数量、增量索引 |
| Ollama 模型下载大 | 中 | 低 | 仅下载必需模型 |

---

## 十、结论

**推荐方案：A (iFrame 嵌入) 或 B (功能移植)**

理由（iFrame）：
1. 快速验证，无需大规模重构
2. 保持架构清晰，职责分离
3. 可独立升级 MarkItUp
4. 保留未来功能移植的可能性

理由（功能移植）：
1. 体验完全一致
2. UI 组件复用
3. 主题自动同步
4. 无跨域通信复杂度

理由：
1. 快速验证，无需大规模重构
2. 保持架构清晰，职责分离
3. 可独立升级 MarkItUp
4. 保留未来功能移植的可能性

**下一步行动：**
1. 用户确认方案（iFrame 快速验证 或 功能移植长期方案）
2. Docker 部署 MarkItUp（如选择 iFrame 方案）
3. 创建 KnowledgePage 组件
4. 配置 PostMessage 通信（如选择 iFrame 方案）
5. 如选择功能移植：抽取 TipTap 编辑器组件

---

## 附录

### A. MarkItUp Docker 环境变量

| 变量 | 必需 | 默认值 | 描述 |
|------|------|--------|------|
| `PORT` | 否 | 3000 | 容器内部端口 |
| `HOSTNAME` | 否 | 0.0.0.0 | 监听地址 |
| `NODE_ENV` | 否 | production | 运行环境 |
| `JWT_SECRET` | 是 | - | JWT 签名密钥（32+ 字符） |
| `ENCRYPTION_KEY` | 是 | - | 加密密钥（32 字符） |
| `DISABLE_AUTH` | 否 | false | 禁用认证（仅开发用） |

### B. PostMessage 消息协议

```typescript
// Host -> MarkItUp
type HostMessage =
  | { type: 'navigate'; path: string }
  | { type: 'search'; query: string }
  | { type: 'create-note'; title?: string }
  | { type: 'update-theme'; theme: 'light' | 'dark' };

// MarkItUp -> Host
type MarkItUpMessage =
  | { type: 'ready' }
  | { type: 'auth-status'; authenticated: boolean }
  | { type: 'note-created'; noteId: string; title: string }
  | { type: 'note-updated'; noteId: string }
  | { type: 'navigated'; path: string }
  | { type: 'error'; code: string; message: string };
```

### C. 相关资源

- MarkItUp 仓库：https://github.com/xclusive36/MarkItUp
- Ollama 下载：https://ollama.ai
- Transformers.js：https://huggingface.co/docs/transformers.js
