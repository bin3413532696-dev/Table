# Table

<a href="https://github.com/bin3413532696-dev/Table/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
<img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React">
<img src="https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript" alt="TypeScript">
<img src="https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi" alt="FastAPI">
<img src="https://img.shields.io/badge/Python-3.11-3776AB?logo=python" alt="Python">
<img src="https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql" alt="PostgreSQL">

`Table` 是一个个人工作台应用，前端为 **React + TypeScript**，后端为 **Python FastAPI**。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18, TypeScript, Webpack 5, Tailwind CSS |
| 后端 | FastAPI, SQLAlchemy, PostgreSQL |
| OCR | 独立 Python OCR 服务 (PaddleOCR) |
| Agent | LangGraph, 多 Provider (OpenAI, Anthropic, Gemini) |
| RAG | 混合检索 (语义 + BM25), MMR / Cross-encoder 重排 |

## 快速开始

### 前置条件

- Node.js >= 18
- Python >= 3.11, < 3.12
- PostgreSQL >= 15
- [uv](https://docs.astral.sh/uv/) (Python 包管理器)

### 步骤

```bash
# 1. 安装前端依赖
npm install

# 2. 安装 Python 依赖
uv sync --package table-python-backend
uv sync --package table-ocr-service

# 3. 配置环境变量
copy .env.example .env
# 编辑 .env，设置 DATABASE_URL 等必要配置

# 4. 执行数据库迁移
npx prisma migrate deploy
npx prisma generate

# 5. 启动 Python 后端
npm run backend:dev

# 6. 启动前端开发服务器（新终端）
npm run dev
```

### 默认地址

| 服务 | 地址 |
|---|---|
| 前端开发服务 | http://127.0.0.1:3266 |
| Python 后端 API | http://127.0.0.1:8787 |
| OCR 服务 | http://127.0.0.1:8001 |

## 常用命令

```bash
npm run dev                 # 启动前端开发服务器
npm run typecheck           # TypeScript 类型检查
npm run build               # 构建前端生产包
npm run test:frontend-api   # 前端 API 测试
npm run backend:sync        # 同步 Python 依赖
npm run backend:dev         # 启动 Python 后端
npm run backend:test        # 运行后端 pytest 测试
npm run knowledge:smoke     # 知识库烟雾测试
npm run knowledge-rag:smoke # RAG 烟雾测试
npm run agent-rag:smoke     # Agent RAG 烟雾测试
npm run agent-memory:smoke  # Agent 记忆烟雾测试
npm run modules:smoke       # 任务/财务模块烟雾测试
```

## 目录结构

```text
src/                    前端应用 (React + TypeScript)
python-backend/         Python 后端 (FastAPI)
ocr-service/            Python OCR 服务 (PaddleOCR)
prisma/                 数据库 schema 与迁移
scripts/
  ├── smoke/            烟雾测试脚本
  └── e2e/              端到端测试脚本
tests/frontend-api/     前端 API 层测试
python-backend/tests/   后端 pytest 测试
```

## API 端点

Python 后端当前覆盖以下模块：

- `/api/auth` — 认证与会话
- `/api/tasks` — 任务管理
- `/api/finance` — 财务记录
- `/api/knowledge` — 知识笔记
- `/api/knowledge-rag` — RAG 知识库
- `/api/providers` — AI Provider 管理
- `/api/maintenance` — 数据维护
- `/api/agent` — 智能体

## 迁移说明

项目原为 TypeScript 全栈，现已迁移到 Python 后端。迁移过程和当前状态见 [PYTHON_MIGRATION.md](./PYTHON_MIGRATION.md)。

## 贡献

请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md) 和 [SECURITY.md](./SECURITY.md)。

## 许可证

[MIT](./LICENSE)
