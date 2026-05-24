# Table

`Table` 是一个个人工作台应用，整合了任务管理、财务记录、知识笔记、RAG 知识库检索、模型 Provider 配置以及 AI Agent 运行时。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript、Webpack 5、Tailwind CSS、TipTap、Framer Motion |
| 后端 | Fastify 5、TypeScript |
| 数据库 | PostgreSQL、Prisma 6、pgvector、pg_trgm |
| Agent 运行时 | LangGraph、LangChain ChatModel、PostgreSQL checkpointer |
| RAG 系统 | pgvector 向量搜索、全文检索、RRF 融合、Query Intent Router |
| 认证 | 签名 Session Cookie、CSRF Token、可选 PIN 锁 |

## 主要能力

- **任务管理**：增删改查、乐观锁、优先级与截止日期
- **财务记录**：统计、图表、导出数据结构
- **知识笔记**：编辑、搜索、预设标签
- **RAG 知识库**：文档解析、分块索引、混合检索、智能上下文组装
- **AI Provider**：OpenAI 兼容、Anthropic、Gemini、自定义端点
- **Agent 运行时**：工具调用、确认流程、checkpoint 恢复、Grounding Guardrail

## RAG 系统架构

知识库检索系统位于 `server/src/modules/knowledge-rag/`，包含：

| 层级 | 功能 | 关键文件 |
| --- | --- | --- |
| 文档解析层 | PDF/MD/TXT 解析 | `indexing/document-parser.ts` |
| 分块索引层 | RecursiveCharacterTextSplitter + Embedding | `indexing/chunker.ts`, `indexing/embedder.ts` |
| 混合检索层 | pgvector + PostgreSQL FTS | `retrieval/hybrid-search.ts` |
| 重排序层 | RRF 融合算法 | `retrieval/reranker.ts` |
| 意图路由层 | Query Intent Router | `retrieval/query-router.ts` |
| 上下文组装层 | Facet-aware 智能组装 | `retrieval/context-builder.ts` |
| Agent 工具层 | rag_answer 一体化检索 | `agent/langgraph/tools.ts` |

### RAG 工具

| 工具名 | 功能 |
| --- | --- |
| `rag_answer` | 一体化检索（搜索 + 引用标注） |
| `semantic_search` | 向量语义搜索（返回 chunk ID） |
| `keyword_search` | 关键词精确搜索（返回 chunk ID） |
| `chunk_read` | 读取单个 chunk 完整内容 |
| `cite_sources` | 标注引用来源 |

### 检索流程

```
Query → Intent Router → 混合检索 → RRF 融合 → Facet Coverage → LLM Context
```

- **Query Intent Router**：识别查询意图（概念性/事实性/混合），推荐最佳工具
- **Facet-aware 组装**：Greedy Set-Cover 确保覆盖最大化
- **Query Embedding 缓存**：避免重复 API 调用

## Agent 运行时

Agent 运行时位于 `server/src/modules/agent/langgraph/`。

### 工作流节点

```
init → build_messages → call_model → parse_tools → check_confirmation
→ execute_tools / request_confirmation → finalize
```

### 工具分组

| 类型 | 工具 |
| --- | --- |
| 查询类 | query_tasks, get_task_stats, query_finance, get_finance_stats, search_knowledge, rag_answer, semantic_search, keyword_search |
| 写操作 | create_task, update_task, delete_task, add_finance_record |
| 引用类 | cite_sources, chunk_read |

### Grounding Guardrail

- Agent 回答知识库问题时必须引用来源
- `rag_answer` 一体化工具自带引用标注，无需额外调用 cite_sources
- 低置信度（< 0.4）时提示用户结果可能不准确

## 运行要求

- Node.js 18+
- npm
- PostgreSQL（需启用 pgvector 和 pg_trgm 扩展）

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 复制环境变量文件：

```bash
copy .env.example .env
```

3. 配置 `.env`：

- `DATABASE_URL`（必填）
- Provider 相关配置（可选，用于自动初始化）

4. 执行数据库迁移：

```bash
npx prisma migrate deploy
npx prisma generate
```

5. 初始化基础数据：

```bash
npm run server:seed
```

6. 启动后端：

```bash
npm run server:dev
```

7. 启动前端：

```bash
npm run dev
```

本地默认地址：

- 前端开发服务：`http://127.0.0.1:3266`
- 后端 API：`http://127.0.0.1:8787`

## 常用命令

```bash
npm run typecheck          # 前端类型检查
npm run server:typecheck   # 后端类型检查
npm run build              # 前端构建
npm run server:build       # 后端构建
npm run server:seed        # 初始化数据
npm run agent:e2e          # Agent E2E 测试
npm run knowledge:e2e      # 知识库 E2E 测试
npm run knowledge:smoke    # 知识库冒烟测试
```

## 目录结构

```text
src/                    前端应用
server/                 后端应用
prisma/                 Schema 与迁移
scripts/                冒烟测试与 E2E 脚本
dist-server/            后端编译产物
```

重要后端模块：

- `server/src/modules/auth` - 认证
- `server/src/modules/tasks` - 任务管理
- `server/src/modules/finance` - 财务记录
- `server/src/modules/knowledge` - 知识笔记
- `server/src/modules/knowledge-rag` - RAG 知识库
- `server/src/modules/providers` - Provider 配置
- `server/src/modules/agent` - Agent 运行时

重要前端区域：

- `src/pages` - 页面组件
- `src/components` - 通用组件
- `src/agent` - Agent 侧边栏
- `src/lib` - API 封装、认证
- `src/store` - 内存状态
- `src/sync` - 服务端同步

## 安全说明

- 非 `GET` 请求必须携带有效的 CSRF Token
- 签名 Session Cookie 是默认认证路径
- `ALLOW_DEFAULT_USER_FALLBACK=true` 仅适用于本地开发
- 生产环境不要使用默认的 `PROVIDER_SECRET_KEY`
- Provider URL 仅允许 HTTPS，阻止内网 IP（SSRF 防护）
- API Key 使用 AES-256 加密存储

## 当前状态

- 前后端可在本地正常运行
- 任务、财务、知识笔记模块已启用
- RAG 知识库检索已启用（文档解析、向量索引、混合搜索、意图路由）
- Agent 运行时已启用（工具调用、确认流程、checkpoint 恢复）
- Grounding Guardrail 已启用（引用验证、低置信度提示）