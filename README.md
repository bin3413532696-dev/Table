# Table

`Table` 是一个个人工作台应用，当前正式后端实现为 `python-backend`（FastAPI），前端为 React + TypeScript。

## 当前技术栈

- 前端：React 18、TypeScript、Webpack 5、Tailwind CSS
- 后端：FastAPI、SQLAlchemy、PostgreSQL
- OCR：独立 Python OCR 服务
- Agent / RAG：统一走 Python 后端 API

## 当前状态

- TypeScript 后端已退役，不再作为正式运行入口
- 前端已收口到统一 API，不再依赖旧 TS 后端实现细节
- Python 后端测试当前基线：`102 passed, 5 skipped`

## 快速开始

1. 安装前端依赖

```bash
npm install
```

2. 安装 Python 依赖

```bash
uv sync --package table-python-backend
uv sync --package table-ocr-service
```

3. 复制环境变量

```bash
copy .env.example .env
```

4. 执行数据库迁移

```bash
npx prisma migrate deploy
npx prisma generate
```

5. 启动 Python 后端

```bash
npm run backend:dev
```

6. 启动前端

```bash
npm run dev
```

默认地址：

- 前端开发服务：`http://127.0.0.1:3266`
- Python 后端 API：`http://127.0.0.1:8787`
- OCR 服务：`http://127.0.0.1:8001`

## 常用命令

```bash
npm run dev
npm run typecheck
npm run build
npm run test:frontend-api
npm run backend:sync
npm run backend:dev
npm run backend:test
npm run knowledge:smoke
npm run knowledge:e2e
npm run agent:e2e
npm run agent:modules:e2e
```

## 目录结构

```text
src/                    前端应用
python-backend/         正式 Python 后端
ocr-service/            Python OCR 服务
prisma/                 数据库 schema 与迁移
scripts/                smoke / e2e 脚本
tests/frontend-api/     前端 API 层测试
```

## 后端说明

Python 后端当前已覆盖：

- `/api/auth`
- `/api/tasks`
- `/api/finance`
- `/api/knowledge`
- `/api/knowledge-rag`
- `/api/providers`
- `/api/maintenance`
- `/api/agent`

## 迁移说明

迁移过程和当前状态见 [PYTHON_MIGRATION.md](./PYTHON_MIGRATION.md)。
