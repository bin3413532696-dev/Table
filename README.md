# Table

[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python)](https://www.python.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql)](https://www.postgresql.org)
[![Tests](https://img.shields.io/badge/tests-backend%2Bfrontend%2Bocr%2Bsmoke-brightgreen)]()

**Table** 是一个面向**个人使用**的 AI 工作台，核心场景不是通用办公，而是**从大体量资料中持续学习新知识**。你可以上传 PDF、Markdown、TXT 以及扫描件等资料，系统会自动完成解析、切片、混合检索、重排与 OCR 降级；围绕同一份教材或资料反复提问时，检索会持续收敛到相关段落。在此基础上，项目还提供基于 LangGraph 的 Agent 编排能力，让单轮对话可以跨知识库、任务、财务等模块联动。

## 界面预览

![AI 智能体首页](docs/images/agent-home.png)

---

## 项目定位

- 面向个人用户，而不是团队协作平台
- 核心场景是从大型资料中系统学习，而不是只做文件存储
- 资料类型不限于 PDF，也覆盖 Markdown、TXT、扫描件等长文档场景
- RAG 负责把资料变成可反复查询的知识底座，Agent 负责在同一轮对话中跨模块编排操作

## 功能特性

| 模块 | 说明 |
|------|------|
| ✅ **RAG 知识库** | 支持 PDF / TXT / Markdown / 扫描件等资料上传，自动完成解析、切片、嵌入、混合检索、MMR 与 Cross-encoder 重排 |
| ✅ **资料集管理** | 可将同一主题下的多份资料归组，便于围绕单门课程、一本教材或一组长文档持续提问 |
| ✅ **AI 智能体（首页）** | 基于 LangGraph 的多 Provider Agent，对话中可调用知识库、任务、财务等工具，并结合会话记忆与长期记忆 |
| ✅ **OCR 识别** | 扫描件、图片和无文本层 PDF 的降级识别与版面分析，作为 RAG 解析链路的一部分 |
| ✅ **知识笔记** | 富文本 / Markdown 编辑器、标签分类、元数据筛选 |
| ✅ **任务管理** | 增删改查、优先级、截止日期、筛选排序 |
| ✅ **财务记账** | 收支分类记录、统计图表、月度概览 |
| ✅ **Provider 管理** | 加密存储 API 密钥、多 Provider 切换、环境变量自动引导 |
| ✅ **工具中心** | 常用工具快捷入口 |

---

## 技术栈

| 层 | 技术 |
|---|---|
| **前端** | React 18, TypeScript 5, Webpack 5, Tailwind CSS 3, Framer Motion, Recharts, TipTap |
| **后端** | FastAPI, SQLAlchemy 2.0, asyncpg, PostgreSQL 15 |
| **OCR** | Python 独立服务 (PaddleOCR + PyMuPDF) |
| **AI Agent** | LangGraph, Provider 流式适配, 会话记忆与长期记忆 |
| **RAG** | 多格式资料解析, 父子分块, 文本嵌入 + pgvector, BM25 全文检索, MMR 重排, Cross-encoder 精排 |
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

npm ci                                   # 前端依赖
uv sync --default-index https://pypi.org/simple --package table-python-backend    # 后端依赖
uv sync --default-index https://pypi.org/simple --package table-ocr-service       # OCR 依赖
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

若本地 `DATABASE_URL` 指向 `127.0.0.1` / `localhost`，该命令在 Windows 下会先尝试自动拉起本地 PostgreSQL，再进入 uvicorn 热重载。

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

## 根目录导航

先把根目录理解成 5 类内容，而不是把所有目录都当成“项目源码”：

- **核心业务目录**：`src/`、`python-backend/`、`ocr-service/`、`prisma/`
- **工程与质量目录**：`scripts/`、`tests/`、`docs/`、`.github/`
- **顶层配置文件**：`package.json`、`pyproject.toml`、`webpack.config.js`、`tsconfig*.json`、`.env.example`
- **项目级 AI 协作目录**：`.Codex/`
- **本地产物目录**：`node_modules/`、`.venv/`、`dist/`、`dist-frontend-tests/`、`__pycache__/`、`.pytest_cache/`、`.ruff_cache/`、`.tmp/`

常见入口建议：

- 看前端业务代码：`src/`
- 看后端接口与服务：`python-backend/`
- 看 OCR 链路：`ocr-service/`
- 看数据库迁移：`prisma/`
- 看自动化脚本与测试：`scripts/`、`tests/`（含前端契约 / DOM 交互测试）
- 看项目规范和结构治理：`AGENTS.md`、`.Codex/`

说明：

- `.Codex/` 是当前项目级 AI 协作主目录；新的计划、技能和结构治理资产统一放这里。
- `.claude/`、`.agents/` 视为历史或并存工具目录，兼容保留，但不再作为新的项目主约定入口。
- 项目规范的单一事实来源是根 `AGENTS.md` 与 `.Codex/`；如果 `.claude/` 中保留兼容文档，它们应是薄镜像，而不是另一套独立规范。
- `node_modules/`、`dist/`、`.venv/` 等属于本地环境或构建副产物，不代表项目正式结构。

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://postgres:postgres@127.0.0.1:5432/table_dev` |
| `PROVIDER_SECRET_KEY` | 会话签名密钥（**生产环境务必更换**） | `table-dev-provider-secret-key-change-me` |
| `SERVER_HOST` | 后端监听地址 | `127.0.0.1` |
| `SERVER_PORT` | 后端监听端口（兼容 `PYTHON_SERVER_PORT`） | `8787` |
| `DEFAULT_USER_ID` | 开发环境默认用户 UUID | `00000000-0000-0000-0000-000000000001` |
| `ALLOW_DEFAULT_USER_FALLBACK` | 允许未登录时回退到默认用户 | `false` |
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
## 常用命令

### 前端

```bash
npm run dev                # 启动开发服务器
npm run build              # 构建生产包
npm run lint               # 前端 + 后端 lint
npm run check              # 完整检查入口
npm run prepush:check      # 推送前最小自检
npm run prepush:check:full # 推送前完整自检（含后端/OCR/basic smoke）
npm run check:bundle-size  # 校验生产 bundle 不明显恶化
npm run typecheck          # TypeScript 类型检查
npm run test:frontend-api  # 前端契约 + DOM 交互测试
```

### 后端

```bash
npm run backend:dev        # 预检/自启动本地 PostgreSQL（Windows）后启动 Python 后端（热重载）
npm run backend:dev:raw    # 直接启动 Python 后端（跳过数据库自启动包装）
npm run backend:sync       # 同步 Python 依赖
npm run backend:test       # 运行全部 pytest 测试
npm run backend:test:unit  # 后端单元层
npm run backend:test:integration  # 真实 PostgreSQL 集成层
npm run backend:test:startup      # FastAPI 启动链路 / fail-fast
npm run backend:test:conventions  # 后端约定测试
npm run backend:test:ci    # CI 聚合入口
```

### OCR

```bash
npm run ocr:dev            # 启动 OCR 服务
npm run ocr:test           # OCR 服务最小自动化测试
```

### 烟雾测试

```bash
npm run smoke:basic          # 基础后端业务冒烟（任务 + 财务）
npm run knowledge:smoke      # 知识笔记
npm run knowledge-rag:smoke  # RAG 知识库
npm run agent-rag:smoke      # Agent RAG 工具
npm run agent-memory:smoke   # Agent 记忆
npm run modules:smoke        # 任务 + 财务
```

说明：

- `npm run smoke:basic` 会自动拉起并清理本地后端，无需手动先启动 `npm run backend:dev`
- 其余 `*:smoke` 与 `*:e2e` 默认仍要求后端已可访问

### 端到端测试

```bash
npm run agent:e2e         # Agent 全流程
npm run knowledge:e2e     # 知识库全流程
npm run agent:modules:e2e # Agent + 模块交互
```

### 测试分层

| 层级 | 目标 | 入口 |
|------|------|------|
| `unit` | 纯逻辑、schema、轻量 service 行为 | `npm run backend:test:unit` |
| `integration` | 真实 PostgreSQL、repository/service 跨层行为 | `npm run backend:test:integration` |
| `startup` | `lifespan`、启动清理、副作用、数据库不可达 fail-fast | `npm run backend:test:startup` |
| `conventions` | 文档、结构、边界、公共入口约束 | `npm run backend:test:conventions` |
| `frontend-api` | 前端 API 契约、结构约束与关键 DOM 交互 | `npm run test:frontend-api` |
| `ocr` | OCR 服务健康与最小处理路径 | `npm run ocr:test` |
| `smoke` | 已启动服务上的关键业务最小可用路径 | `npm run smoke:basic` 等 |
| `e2e` | 跨模块完整用户流程 | `npm run agent:e2e` 等 |

后端采用 `fail-fast` 启动策略：数据库不可用、关键迁移缺失或启动前置条件不满足时，服务应直接启动失败。`startup` 层专门覆盖这类问题；依赖 override 的 API 测试不视为启动覆盖。

当前建议的最小回归入口：

- `npm run backend:test:ci`
- `npm run test:frontend-api`
- `npm run ocr:test`
- `npm run smoke:basic`

### 启动前置条件

在运行 `npm run backend:dev` 前，至少确保：

```bash
uv sync --default-index https://pypi.org/simple --package table-python-backend
npx prisma migrate deploy
```

并确认：

- PostgreSQL 正在监听 `127.0.0.1:5432`
- `DATABASE_URL` 指向可连接数据库
- 数据库已启用 `pgvector` 扩展
- 若本地通过 `x-user-id` 运行 smoke / e2e，需要显式设置 `ALLOW_DEFAULT_USER_FALLBACK=true` 或相关开发认证配置

Windows 本地开发下，如果 PostgreSQL 安装路径无法从系统服务自动发现，可在 `.env` 中显式提供：

```bash
TABLE_POSTGRES_SERVICE=postgresql-x64-18
# 或直接指定 pg_ctl 与数据目录
TABLE_POSTGRES_CTL=D:\app\database\PostgreSQL\18\bin\pg_ctl.exe
TABLE_POSTGRES_DATA_DIR=D:\appdata\database\PostgreSQL\18\data
```

---

## 目录结构

```text
Table/
├── .Codex/                           # 项目级 Codex 资产：plans / skills / 架构治理文档
├── docs/                             # 项目文档与截图资源
├── scripts/                          # 烟雾测试 / E2E / 工程检查脚本
├── tests/                            # 前端契约 / DOM 交互测试与仓库级约定测试
├── src/                              # 前端源码
│   ├── app/                          # 应用入口、路由、全局 Provider、布局装配
│   │                                 # 只允许依赖 feature 公共入口，不要直接耦合 feature 深层实现
│   ├── features/                     # 业务模块权威位置
│   │   ├── agent/                    # Agent API、运行时、类型、历史页入口
│   │   ├── dashboard/                # 首页页面入口
│   │   ├── finance/                  # 财务模块 API、页面、store
│   │   ├── knowledge/                # 知识笔记 + RAG + 同步统一模块
│   │   ├── settings/                 # 设置页与维护 API
│   │   ├── tasks/                    # 任务模块 API、页面、store
│   │   └── tools/                    # 工具页入口
│   ├── shared/                       # 跨模块共享 API / hooks / store 基础能力
│   ├── components/                   # 通用 UI 组件，不反向依赖业务 feature
│   ├── contexts/                     # React Context（主题、用户）
│   ├── hooks/                        # 通用 React hooks
│   ├── styles/                       # 全局样式（Tailwind + 主题变量）
│   ├── App.tsx                       # 前端兼容入口，转发到 app/App
│   └── index.tsx                     # 前端挂载入口
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
│   └── tests/                        # pytest 测试套件
│
├── ocr-service/                      # OCR 独立服务 (PaddleOCR)
│   ├── ocr_service/                  # OCR 处理逻辑
│   ├── main.py                       # FastAPI 入口
│   └── Dockerfile
│
├── prisma/                           # 数据库 Schema 与迁移
│   └── schema.prisma                 # 16 个模型（User/Task/Finance/Knowledge 等）
├── .github/                          # PR / Issue 模板与协作配置
├── webpack.config.js                 # 构建配置
├── tsconfig.json                     # TypeScript 配置
├── tailwind.config.js                # 主题系统
├── pyproject.toml                    # uv workspace
└── .env.example                      # 环境变量模板
```

为避免根目录认知噪音，上面的目录树**故意不展示** `node_modules/`、`.venv/`、`dist/`、`dist-frontend-tests/`、`__pycache__/`、`.pytest_cache/`、`.ruff_cache/`、`.tmp/` 等本地产物目录。

约定补充：

- `src/app` 只负责装配，不直接 import `features/<domain>/(api|components|pages|runtime|store|sync|types)/...`
- `src/app` 引入 feature 统一走 `features/<domain>/public` 或 `features/<domain>/page`
- `src/components` 只保留通用组件，不依赖 `src/features`
- `app.services.agent.public`、`app.services.knowledge_rag_public` 是后端正式公开入口；`app.services.agent.__init__`、`app.services.knowledge_rag` 仅保留历史兼容职责
- 生产构建允许存在已知体积告警，但 `npm run check:bundle-size` 会阻止关键 bundle 明显恶化
- `npm run check:bundle-size` 的输出会列出当前 tracked bundle 与存量告警；触及相关页面或依赖时应优先削减这些存量体积债务

前端结构约定：

- 新的业务代码优先进入 `src/features/<domain>/`
- 可跨模块复用的通用能力进入 `src/shared/`
- 旧的 `src/lib/` 已完成迁移，新代码不应再恢复这种按“公共杂项”堆放的目录模式

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
| 后端 `unit` + `integration` + `startup` + `conventions` | `npm run backend:test:ci` | pytest 分层门禁 |
| 前端契约 / 交互测试 | `npm run test:frontend-api` | Node 测试运行器 + JSDOM |
| OCR 测试 | `npm run ocr:test` | 健康检查 + 最小处理路径 |
| 烟雾测试 | `npm run smoke:basic` | 自动拉起后端并验证任务 + 财务基础链路 |
| 烟雾测试 | `npm run knowledge:smoke` | 知识笔记 |
| 烟雾测试 | `npm run knowledge-rag:smoke` | RAG 搜索流程 |
| 烟雾测试 | `npm run agent-rag:smoke` | Agent RAG 工具 |
| 烟雾测试 | `npm run agent-memory:smoke` | Agent 记忆持久化 |
| E2E 测试 | `npm run agent:e2e` | Agent 全流程（需启动后端） |
| E2E 测试 | `npm run knowledge:e2e` | 知识库全流程 |
| E2E 测试 | `npm run agent:modules:e2e` | Agent + 模块交互 |

前端测试当前已覆盖：

- API 契约与错误映射
- 目录 / 公共入口 / 分层边界约束
- `App` / `PinLock` / `DocumentUploader` 的关键交互
- `RagSection` 的上传、资料集、检索、详情、重新索引、加入资料集链路

---

## 项目背景

Table 最初是一个通用个人工作台，后续逐步收敛为一个**服务个人学习场景的 RAG + Agent 应用**：重点解决“大资料读不完、问不准、跨轮对话记不住上下文”的问题。历史上项目曾是 TypeScript 全栈应用（Express + Prisma + React），现已迁移到 Python 后端（FastAPI + SQLAlchemy），`python-backend/` 是唯一正式后端。

---

## 贡献

欢迎提交 Issue 和 Pull Request。请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发规范。安全漏洞请通过 [SECURITY.md](./SECURITY.md) 私密报告。

---

## 许可证

[MIT](LICENSE) © 2026 bin3413532696-dev
