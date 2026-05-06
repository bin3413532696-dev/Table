# Table

`Table` 是一个面向持续扩展的智能工作台平台底座，当前交付内容包括：

- React 前端工作台
- Fastify + Prisma 后端服务
- PostgreSQL 权威数据模型
- 知识库、任务、财务、Provider、智能体运行基础能力

## 运行要求

- Node.js 18+
- npm
- PostgreSQL

## 快速启动

1. 安装依赖：`npm install`
2. 复制环境变量：将 `.env.example` 复制为 `.env`
3. 配置数据库：设置 `.env` 中的 `DATABASE_URL`
4. 执行迁移：`npx prisma migrate deploy`
5. 初始化数据：`npm run server:seed`
6. 启动后端：`npm run server:dev`
7. 启动前端：`npm run dev`

## 构建命令

- 前端类型检查：`npm run typecheck`
- 后端类型检查：`npm run server:typecheck`
- 前端构建：`npm run build`
- 后端构建：`npm run server:build`

## 目录说明

- `src/`：前端应用
- `server/`：后端 API 与运行时
- `prisma/`：数据库 schema 与 migration
- `scripts/`：冒烟、端到端与辅助脚本

## 交付说明

仓库已移除研发交接文档、构建产物、本地调试数据与本地工具目录，当前内容以直接交付和部署所需最小集为准。
