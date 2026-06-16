# Table

[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python)](https://www.python.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql)](https://www.postgresql.org)
[![Tests](https://img.shields.io/badge/tests-168_✓_5_◷-brightgreen)]()

**Table** 是一个**个人工作台**应用，将日常工作中零散的工具集中到统一界面。支持**任务管理**、**财务记账**、**知识笔记**、**AI 知识库 (RAG)**、**AI 智能体对话**及 **OCR 文档识别**，所有数据本地可控。

## 界面预览

![AI 智能体首页](docs/images/agent-home.png)

---

## 功能特性

| 模块 | 说明 |
|------|------|
| ✅ **任务管理** | 增删改查、优先级、截止日期、筛选排序 |
| ✅ **财务记账** | 收支分类记录、统计图表、月度概览 |
| ✅ **知识笔记** | 富文本 / Markdown 编辑器、标签分类、元数据筛选 |
| ✅ **RAG 知识库** | 文档上传 (PDF/TXT/MD)、自动切片索引、语义 + BM25 混合检索、MMR 多样化重排、Cross-encoder 精排、查询预处理 |
| ✅ **AI 智能体（首页）** | 多 Provider (OpenAI / Anthropic / Gemini / 兼容 API)、会话管理、长期记忆、工具调用（创建任务、记账、搜索知识库、RAG 查询）|
| ✅ **Provider 管理** | 加密存储 API 密钥、多 Provider 切换、环境变量自动引导 |
| ✅ **OCR 识别** | PDF / 图片文字提取、版面分析、表格结构提取 |
| ✅ **工具中心** | 常用工具快捷入口 |

---

## 技术栈

| 层 | 技术 |
|---|---|
| **前端** | React 18, TypeScript 5, Webpack 5, Tailwind CSS 3, Framer Motion, Recharts, TipTap |
| **后端** | FastAPI, SQLAlchemy 2.0, asyncpg, PostgreSQL 15 |
| **OCR** | Python 独立服务 (PaddleOCR + PyMuPDF) |
| **AI Agent** | LangGraph, Provider 流式适配 (OpenAI / Anthropic / Gemini) |
| **RAG** | 文本嵌入 + pgvector, BM25 全文检索, MMR 重排, Cross-encoder 精排 |
| **包管理** | npm (前端), uv (Python workspace) |

---

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org) >= 18
- [Python](https://www.python.org) >= 3.11, < 3.12
- [PostgreSQL](https://www.postgresql.org) >= 15（需启用 pgvector 扩展）
- [uv](https://docs.astral.sh/uv/#installation) — Python 包管理器（`pip install uv` 或官网安装）

### 1. 创建数据库

```bash
psql -U postgres -c "CREATE DATABASE table_dev;"
psql -U postgres -d table_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 2. 克隆并安装

```bash
git clone https://github.com/bin3413532696-dev/Table.git
cd Table

npm install                              # 前端依赖
uv sync --package table-python-backend    # 后端依赖
uv sync --package table-ocr-service       # OCR 依赖
```

### 3. 配置环境

```bash
copy .env.example .env
```

所有配置项见[环境变量](#环境变量)章节。

### 4. 数据库迁移

```bash
npx prisma migrate deploy
npx prisma generate
```

### 5. 启动

终端 1 — Python 后端：
```bash
npm run backend:dev
```

终端 2 — 前端开发服务器：
```bash
npm run dev
```

终端 3（可选）— OCR 服务：
```bash
npm run ocr:dev
```

### 6. 访问

| 服务 | 地址 |
|------|------|
| 前端 | http://127.0.0.1:3266 |
| 后端 API | http://127.0.0.1:8787 |
| API 交互文档 | http://127.0.0.1:8787/docs |
| OCR 服务 | http://127.0.0.1:8001 |

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://postgres:postgres@127.0.0.1:5432/table_dev` |
| `PROVIDER_SECRET_KEY` | 会话签名密钥（**生产环境务必更换**） | `change-this-provider-secret-key` |
| `SERVER_HOST` | 后端监听地址 | `127.0.0.1` |
| `SERVER_PORT` | 后端监听端口 | `8787` |
| `DEFAULT_USER_ID` | 开发环境默认用户 UUID | `00000000-0000-0000-0000-000000000001` |
| `ALLOW_DEFAULT_USER_FALLBACK` | 允许未登录时回退到默认用户 | `true` |
| `TRUST_USER_ID_HEADER` | 信任 `x-user-id` 请求头（仅限内网测试） | `false` |
| `DEFAULT_PROVIDER_NAME` | 默认 Provider 名称 | `GLM-5 Provider` |
| `DEFAULT_PROVIDER_FORMAT` | API 格式 (`openai` / `anthropic` / ...) | `openai` |
| `DEFAULT_PROVIDER_BASE_URL` | 默认 API 地址 | — |
| `DEFAULT_PROVIDER_API_KEY` | 默认 API 密钥 | — |
| `DEFAULT_PROVIDER_MODEL` | 默认模型名 | — |
| `EMBEDDING_API_KEY` | RAG 嵌入 API 密钥（不设置则复用活跃 Provider） | — |
| `EMBEDDING_BASE_URL` | RAG 嵌入 API 地址 | — |
| `EMBEDDING_MODEL` | 嵌入模型 | `text-embedding-3-small` |
| `QUERY_PREPROCESSOR_ENABLED` | 启用 RAG 查询预处理 | `false` |
| `QUERY_EXPANSION_COUNT` | 多查询扩展数量 | `3` |
| `QUERY_REWRITE_ENABLED` | 查询改写 | `true` |
| `MMR_ENABLED` | 启用 MMR 多样化重排 | `false` |
| `MMR_LAMBDA` | MMR 多样性参数 (0~1) | `0.7` |
| `RERANKER_ENABLED` | 启用 Cross-encoder 精排 | `false` |
| `RERANKER_TOP_N` | 精排候选数 | `20` |
| `RERANKER_TIMEOUT_MS` | 精排超时 | `2000` |
| `PROJECTION_OUTBOX_POLL_MS` | 投影轮询间隔 | `1500` |
| `PROJECTION_OUTBOX_BATCH_SIZE` | 投影批处理大小 | `20` |

---

## 常用命令

### 前端

```bash
npm run dev                # 启动开发服务器
npm run build              # 构建生产包
npm run typecheck          # TypeScript 类型检查
npm run test:frontend-api  # 前端 API 层测试
```

### 后端

```bash
npm run backend:dev        # 启动 Python 后端（热重载）
npm run backend:sync       # 同步 Python 依赖
npm run backend:test       # 运行 pytest 测试
```

### OCR

```bash
npm run ocr:dev            # 启动 OCR 服务
```

### 烟雾测试

```bash
npm run knowledge:smoke      # 知识笔记
npm run knowledge-rag:smoke  # RAG 知识库
npm run agent-rag:smoke      # Agent RAG 工具
npm run agent-memory:smoke   # Agent 记忆
npm run modules:smoke        # 任务 + 财务
```

### 端到端测试

```bash
npm run agent:e2e         # Agent 全流程
npm run knowledge:e2e     # 知识库全流程
npm run agent:modules:e2e # Agent + 模块交互
```

---

## 目录结构

```text
Table/
├── src/                              # 前端源码
│   ├── agent/                        # Agent 运行时（hooks、状态、存储、流式缓冲）
│   ├── components/                   # 通用 UI 组件
│   │   ├── Agent/                    # Agent 侧边栏、会话记忆卡片
│   │   └── ui/                       # 基础组件（按钮、输入框、标签等）
│   ├── contexts/                     # React Context（主题、用户）
│   ├── hooks/                        # 自定义 Hooks
│   ├── lib/                          # API 客户端、认证、工具函数
│   │   └── api/                      # 各模块 API 封装（tasks, finance 等）
│   ├── pages/                        # 7 个页面
│   │   ├── Tasks/                    # 任务管理
│   │   ├── Finance/                  # 财务记账
│   │   ├── Knowledge/                # 知识笔记
│   │   ├── KnowledgeRag/             # RAG 知识库
│   │   ├── AgentHistory/             # Agent 历史记录
│   │   ├── Settings/                 # 设置页
│   │   └── Tools/                    # 工具中心
│   ├── store/                        # 状态管理
│   ├── styles/                       # 全局样式（Tailwind + 主题变量）
│   └── sync/                         # 数据同步引擎
│
├── python-backend/                   # Python 后端 (FastAPI)
│   ├── app/
│   │   ├── api/routes/               # 9 个路由模块
│   │   │   ├── auth.py               # 认证与会话（含 PIN 码）
│   │   │   ├── tasks.py              # 任务 CRUD
│   │   │   ├── finance.py            # 财务 CRUD
│   │   │   ├── knowledge.py          # 知识笔记 + 标签 + 元数据
│   │   │   ├── knowledge_rag.py      # RAG 文档/索引/搜索/统计
│   │   │   ├── providers.py          # Provider CRUD + 激活
│   │   │   ├── agent.py              # Agent 会话/运行/流式执行/工具确认
│   │   │   ├── maintenance.py        # 数据备份与重置
│   │   │   └── health.py             # 健康检查
│   │   ├── core/                     # 核心模块（配置、CSRF、会话、加密）
│   │   ├── db/                       # SQLAlchemy 模型与会话
│   │   ├── repositories/             # 数据访问层
│   │   ├── schemas/                  # Pydantic 请求/响应模型
│   │   └── services/                 # 业务逻辑层
│   │       ├── agent/                # LangGraph Agent（含工具注册）
│   │       │   └── tools/            # Agent 工具（tasks/finance/knowledge/rag）
│   │       ├── knowledge_rag_*.py    # RAG 索引/嵌入/检索/重排
│   │       └── provider_bootstrap.py # Provider 环境变量引导
│   └── tests/                        # 168 个 pytest 测试
│
├── ocr-service/                      # OCR 独立服务 (PaddleOCR)
│   ├── ocr_service/                  # OCR 处理逻辑
│   ├── main.py                       # FastAPI 入口
│   └── Dockerfile
│
├── prisma/                           # 数据库 Schema 与迁移
│   └── schema.prisma                 # 16 个模型（User/Task/Finance/Knowledge 等）
│
├── scripts/
│   ├── smoke/                        # 5 个烟雾测试脚本
│   └── e2e/                          # 3 个端到端测试脚本
│
├── tests/frontend-api/               # 前端 API 层测试
├── .github/                          # PR / Issue 模板
├── webpack.config.js                 # 构建配置
├── tsconfig.json                     # TypeScript 配置
├── tailwind.config.js                # 主题系统
├── pyproject.toml                    # uv workspace
└── .env.example                      # 环境变量模板
```

---

## API 端点一览

### 认证 `/api/auth`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/me` | 当前用户信息 |
| GET | `/api/auth/users` | 用户列表 |
| POST | `/api/auth/users` | 创建用户 |
| PATCH | `/api/auth/me` | 更新当前用户 |
| POST | `/api/auth/session` | 创建会话（登录） |
| DELETE | `/api/auth/session` | 销毁会话（登出） |
| GET | `/api/auth/pin` | 获取 PIN 状态 |
| POST | `/api/auth/pin/verify` | 验证 PIN |
| PATCH | `/api/auth/pin` | 设置/更新 PIN |
| DELETE | `/api/auth/pin` | 删除 PIN |

### 任务 `/api/tasks`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks` | 创建任务 |
| GET | `/api/tasks/{id}` | 任务详情 |
| PATCH | `/api/tasks/{id}` | 更新任务 |
| DELETE | `/api/tasks/{id}` | 删除任务 |

### 财务 `/api/finance`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/finance` | 财务记录列表 |
| POST | `/api/finance` | 创建记录 |
| GET | `/api/finance/{id}` | 记录详情 |
| PATCH | `/api/finance/{id}` | 更新记录 |
| DELETE | `/api/finance/{id}` | 删除记录 |

### 知识笔记 `/api/knowledge`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/knowledge/notes` | 笔记列表 |
| POST | `/api/knowledge/notes` | 创建笔记 |
| GET | `/api/knowledge/notes/{id}` | 笔记详情 |
| PATCH | `/api/knowledge/notes/{id}` | 更新笔记 |
| DELETE | `/api/knowledge/notes/{id}` | 删除笔记 |
| GET | `/api/knowledge/search` | 搜索笔记 |
| GET | `/api/knowledge/tags/preset` | 预设标签列表 |
| POST | `/api/knowledge/tags/preset` | 创建预设标签 |
| GET/PATCH/DELETE | `/api/knowledge/tags/preset/{id}` | 标签 CRUD |

### RAG 知识库 `/api/knowledge-rag`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/knowledge-rag/documents` | 文档列表（支持筛选分页） |
| POST | `/api/knowledge-rag/documents/upload` | 上传文档 |
| GET | `/api/knowledge-rag/documents/{id}` | 文档详情 |
| PATCH | `/api/knowledge-rag/documents/{id}` | 更新文档元数据 |
| DELETE | `/api/knowledge-rag/documents/{id}` | 删除文档 |
| POST | `/api/knowledge-rag/documents/{id}/index` | 触发索引 |
| POST | `/api/knowledge-rag/documents/{id}/backfill` | 回填嵌入 |
| POST | `/api/knowledge-rag/search` | 混合搜索 |
| POST | `/api/knowledge-rag/search/context` | 上下文搜索 |
| GET | `/api/knowledge-rag/chunks` | 查询文档块 |
| GET | `/api/knowledge-rag/jobs` | 索引任务列表 |
| GET | `/api/knowledge-rag/jobs/{id}` | 索引任务详情 |
| GET | `/api/knowledge-rag/stats` | 知识库统计 |
| GET | `/api/knowledge-rag/ocr/health` | OCR 服务健康检查 |

### Provider `/api/providers`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/providers` | Provider 列表 |
| GET | `/api/providers/active` | 当前活跃 Provider |
| POST | `/api/providers` | 创建 Provider |
| PATCH | `/api/providers/{id}` | 更新 Provider |
| DELETE | `/api/providers/{id}` | 删除 Provider |
| POST | `/api/providers/{id}/activate` | 激活 Provider |

### Agent `/api/agent`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agent/health` | Agent 健康检查 |
| GET | `/api/agent/capabilities` | Agent 能力声明 |
| GET | `/api/agent/persona` | 获取人格设定 |
| PUT | `/api/agent/persona` | 更新人格设定 |
| GET | `/api/agent/sessions` | 会话列表 |
| POST | `/api/agent/sessions` | 创建会话 |
| GET | `/api/agent/sessions/{id}` | 会话详情 |
| PATCH | `/api/agent/sessions/{id}` | 更新会话 |
| DELETE | `/api/agent/sessions/{id}` | 删除会话 |
| GET | `/api/agent/sessions/{id}/memory` | 会话记忆 |
| PATCH | `/api/agent/sessions/{id}/memory/settings` | 记忆设置 |
| DELETE | `/api/agent/sessions/{id}/memory` | 清除记忆 |
| GET | `/api/agent/runs` | 运行记录列表 |
| POST | `/api/agent/runs` | 创建运行 |
| POST | `/api/agent/runs/stream` | 流式运行 (SSE) |
| GET | `/api/agent/runs/{id}` | 运行详情 |
| PATCH | `/api/agent/runs/{id}` | 更新运行 |
| DELETE | `/api/agent/runs/{id}` | 删除运行 |
| POST | `/api/agent/runs/{id}/tools/{exec_id}/confirm` | 确认工具调用 |
| POST | `/api/agent/runs/{id}/tools/{exec_id}/confirm/stream` | 确认后流式继续 |
| POST | `/api/agent/runs/{id}/tools/{exec_id}/reject` | 拒绝工具调用 |
| POST | `/api/agent/runs/{id}/tools/{exec_id}/reject/stream` | 拒绝后流式继续 |

### 维护 `/api/maintenance`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/maintenance/business-snapshot` | 导出业务快照 |
| POST | `/api/maintenance/business-snapshot` | 导入业务快照 |
| POST | `/api/maintenance/reset` | 重置工作区 |

### 健康 `/api/health`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 后端健康检查 |

> 完整 OpenAPI 文档启动后端后访问 `http://127.0.0.1:8787/docs`

---

## 测试

| 测试类型 | 命令 | 说明 |
|---------|------|------|
| 后端单元测试 | `npm run backend:test` | **168 passed, 5 skipped** — pytest |
| 前端 API 测试 | `npm run test:frontend-api` | Node 测试运行器 |
| 烟雾测试 | `npm run modules:smoke` | 任务+财务模块，无外部依赖 |
| 烟雾测试 | `npm run knowledge:smoke` | 知识笔记 |
| 烟雾测试 | `npm run knowledge-rag:smoke` | RAG 搜索流程 |
| 烟雾测试 | `npm run agent-rag:smoke` | Agent RAG 工具 |
| 烟雾测试 | `npm run agent-memory:smoke` | Agent 记忆持久化 |
| E2E 测试 | `npm run agent:e2e` | Agent 全流程（需启动后端） |
| E2E 测试 | `npm run knowledge:e2e` | 知识库全流程 |
| E2E 测试 | `npm run agent:modules:e2e` | Agent + 模块交互 |

---

## 项目背景

Table 最初是一个 TypeScript 全栈应用（Express + Prisma + React），后迁移至 Python 后端（FastAPI + SQLAlchemy）。当前 TypeScript 后端已退役，`python-backend/` 是唯一正式后端。

---

## 贡献

欢迎提交 Issue 和 Pull Request。请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发规范。安全漏洞请通过 [SECURITY.md](./SECURITY.md) 私密报告。

---

## 许可证

[MIT](LICENSE) © 2026 bin3413532696-dev
