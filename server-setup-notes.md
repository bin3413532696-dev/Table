# 服务端落地说明

当前仓库已完成从“后端骨架阶段”到“后端权威阶段”的推进。

## 当前真实状态

- `tasks` 已切换为 PostgreSQL 权威
- `finance` 已切换为 PostgreSQL 权威
- `knowledge` 已切换为 PostgreSQL 权威
- knowledge 已完成结构化拆表
- `tasks / finance -> knowledge` 已改为后端 outbox 异步投影
- ontology 已独立拆表

## 当前本地启动步骤

1. 安装依赖：`npm install`
2. 复制 `.env.example` 为 `.env`
3. 准备本地 PostgreSQL，并创建 `table_dev`
4. 执行 `npx prisma migrate deploy`
5. 执行 `npm run server:seed`
6. 执行 `npm run server:dev`

## 当前已具备的开发命令

- `npm run server:dev`
- `npm run server:typecheck`
- `npm run server:build`
- `npm run server:seed`
- `npm run knowledge:smoke`

## 当前未完成部分

- 用户体系与鉴权
- 租户隔离
- 智能体服务端 run 状态机
- 搜索 API 与 FTS
- 向量检索
