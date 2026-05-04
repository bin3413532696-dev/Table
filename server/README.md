# Server

当前目录已经不是“后端骨架”，而是本项目现阶段的真实权威服务端。

## 当前已落地能力

- Fastify 应用入口与统一路由注册
- `tasks` 模块的完整 CRUD
- `finance` 模块的完整 CRUD
- `knowledge` 模块的服务端权威读写
- `maintenance` 模块的 reset、snapshot、seed 能力
- `projection` 模块的 outbox 与异步知识投影运行时
- Prisma schema 与多轮 migration

## 本地准备

1. 安装依赖：`npm install`
2. 复制 `.env.example` 为 `.env`
3. 准备本地 PostgreSQL，并创建 `table_dev` 数据库
4. 执行迁移：`npx prisma migrate deploy`
5. 执行 seed：`npm run server:seed`
6. 启动开发服务：`npm run server:dev`

## 当前结构

- `src/app.ts`
  - 应用装配入口
- `src/db/`
  - Prisma client 与数据库错误处理
- `src/modules/tasks/`
  - 任务模块
- `src/modules/finance/`
  - 财务模块
- `src/modules/knowledge/`
  - 知识库模块
- `src/modules/projection/`
  - outbox 与知识投影运行时
- `src/modules/maintenance/`
  - 开发运维能力
- `src/modules/health/`
  - 健康检查

## 当前限制

- 默认依赖 `.env` 中的 `DATABASE_URL`
- 当前仍使用固定占位 `user_id`
- 还没有真实用户体系、鉴权、租户隔离
- 智能体执行链路仍主要在前端，尚未完成服务端 run 状态机化
- 搜索 API、FTS、向量检索尚未落地
