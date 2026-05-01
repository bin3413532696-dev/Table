# MarkItUp PKM 完整功能集成计划

> 文档版本：v1.0.0
> 创建日期：2026-05-01
> 状态：实施中

---

## 一、技术栈

| 组件 | 技术 | 用途 |
|------|------|------|
| 编辑器 | TipTap + ProseMirror | 富文本编辑 + Wikilinks |
| AI 聊天 | Ollama + `use-local-llm` | 本地流式对话 |
| 向量搜索 | Transformers.js (`@huggingface/transformers`) | 浏览器内语义搜索 |
| 知识图谱 | D3.js | 力导向图可视化 |
| 存储 | IndexedDB (Dexie.js) | 笔记 + 向量存储 |
| 样式 | Tailwind CSS | UI 组件 |

---

## 二、实施阶段

### Phase 1: TipTap 编辑器 + Wikilinks
**预计时间**: 2-3 天

- [ ] 安装 TipTap 依赖
- [ ] 创建 WikiLink 自定义扩展
- [ ] 创建 WikiLinkSuggestion 自动完成扩展
- [ ] 创建 PKMEditor 组件
- [ ] 创建 NoteList 笔记列表组件
- [ ] 创建 BacklinksPanel 反向链接面板

### Phase 2: Transformers.js 语义搜索
**预计时间**: 1-2 天

- [ ] 安装 `@huggingface/transformers`
- [ ] 创建 embeddings.ts 单例
- [ ] 创建 vectorStore.ts IndexedDB 存储
- [ ] 创建 useSemanticSearch hook
- [ ] 集成搜索 UI

### Phase 3: Ollama AI 集成
**预计时间**: 1-2 天

- [ ] 安装 `use-local-llm` 或 `ollama`
- [ ] 创建 ollama.ts 客户端
- [ ] 创建 useAIChat hook
- [ ] 创建 AIChatPanel 组件
- [ ] 支持流式响应

### Phase 4: 知识图谱
**预计时间**: 1-2 天

- [ ] 创建 GraphView.tsx (D3.js)
- [ ] 创建 useKnowledgeGraph hook
- [ ] 图谱交互功能

### Phase 5: AI 高级功能
**预计时间**: 2-3 天

- [ ] 智能链接建议
- [ ] 内容助手
- [ ] 间隔重复 (FSRS)

---

## 三、NPM 依赖

```bash
# TipTap 编辑器
npm install @tiptap/react @tiptap/core @tiptap/starter-kit @tiptap/markdown \
  @tiptap/extension-link @tiptap/extension-image @tiptap/extension-placeholder \
  @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-table \
  @tiptap/suggestion

# Transformers.js
npm install @huggingface/transformers

# Ollama
npm install use-local-llm

# 向量存储
npm install idb

# 已有依赖 (d3, lucide-react, framer-motion)
```

---

## 四、文件结构

```
src/
├── components/
│   ├── Editor/
│   │   ├── PKMEditor.tsx          # TipTap 编辑器
│   │   ├── EditorToolbar.tsx     # 工具栏
│   │   ├── extensions/
│   │   │   ├── WikiLink.ts        # Wikilink 节点
│   │   │   └── WikiLinkSuggestion.ts  # 自动完成
│   │   └── index.ts
│   ├── Graph/
│   │   ├── GraphView.tsx         # D3 力导向图
│   │   └── index.ts
│   ├── AI/
│   │   ├── AIChatPanel.tsx       # AI 对话面板
│   │   └── index.ts
│   └── Knowledge/
│       ├── NoteList.tsx          # 笔记列表
│       ├── BacklinksPanel.tsx    # 反向链接
│       ├── SearchBar.tsx         # 搜索栏
│       └── index.ts
├── lib/
│   ├── embeddings.ts             # Transformers.js 单例
│   ├── vectorStore.ts            # IndexedDB 向量存储
│   ├── ollama.ts                 # Ollama 客户端
│   └── noteDB.ts                 # 笔记数据库操作
├── hooks/
│   ├── useSemanticSearch.ts      # 语义搜索
│   ├── useAIChat.ts              # AI 聊天
│   ├── useKnowledgeGraph.ts      # 知识图谱
│   └── useNotes.ts               # 笔记 CRUD
└── pages/
    └── Knowledge/
        ├── index.tsx            # 主页面 (替换 iFrame)
        ├── NoteView.tsx         # 笔记查看/编辑
        └── NoteListView.tsx     # 笔记列表视图
```

---

## 五、核心实现细节

### 5.1 WikiLink 扩展

```typescript
// extensions/WikiLink.ts
import { Node, mergeAttributes } from '@tiptap/core';

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      name: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="wiki-link"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-type': 'wiki-link', 'data-id': node.attrs.id, 'data-name': node.attrs.name }),
      `[[${node.attrs.name || node.attrs.id}]]`
    ];
  },
});
```

### 5.2 Transformers.js 单例

```typescript
// lib/embeddings.ts
import { pipeline, env } from '@huggingface/transformers';

env.useBrowserCache = true;

class EmbeddingSingleton {
  private static instance: any = null;

  static async getInstance() {
    if (!this.instance) {
      this.instance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return this.instance;
  }
}

export const embedText = async (text: string): Promise<Float32Array> => {
  const extractor = await EmbeddingSingleton.getInstance();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return output.data;
};
```

### 5.3 Ollama 流式聊天

```typescript
// hooks/useAIChat.ts
import { streamChat } from 'use-local-llm';

export function useAIChat() {
  const sendMessage = async (message: string, onToken: (token: string) => void) => {
    await streamChat({
      endpoint: 'http://localhost:11434',
      model: 'llama3.2',
      messages: [{ role: 'user', content: message }],
      onToken,
    });
  };

  return { sendMessage };
}
```

---

## 六、验证标准

### Phase 1 验证
- [ ] `npm run build` 成功，无错误
- [ ] 编辑器可输入文字
- [ ] 输入 `[[` 触发自动完成
- [ ] 点击 WikiLink 可导航到对应笔记
- [ ] 笔记列表显示所有笔记
- [ ] 反向链接面板显示引用当前笔记的所有链接

### Phase 2 验证
- [ ] Transformers.js 模型加载成功 (首次 2-5 秒)
- [ ] 语义搜索返回相关结果
- [ ] 搜索响应时间 < 100ms (千条笔记内)

### Phase 3 验证
- [ ] Ollama 服务连接成功
- [ ] AI 回复流式显示
- [ ] 支持中断生成

### Phase 4 验证
- [ ] 知识图谱渲染正常
- [ ] 点击节点可导航到笔记
- [ ] 图谱随笔记变化更新

---

## 七、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| Transformers.js 模型加载慢 | 中 | 低 | 显示加载进度条，WebGPU 加速 |
| Ollama CORS 限制 | 高 | 中 | 设置 `OLLAMA_ORIGINS=*` 或使用代理 |
| 向量存储性能 | 中 | 中 | 预计算向量模长，限制笔记数量 |
| WikiLink 扩展冲突 | 低 | 中 | 使用独立命名空间 |

---

## 八、部署前提

### Ollama 配置
```bash
# 启动 Ollama (需要 CORS 支持)
OLLAMA_ORIGINS=* ollama serve

# 或在环境变量中
export OLLAMA_ORIGINS=*
```

### 模型下载
```bash
ollama pull llama3.2          # 对话模型
ollama pull nomic-embed-text   # 向量模型 (可选，本地用)
```
