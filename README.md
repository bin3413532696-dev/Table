# Table

`Table` 是一个个人工作台应用，把任务管理、财务记录、知识笔记、模型 Provider 配置以及 AI Agent 运行时整合在同一套系统里。

## 技术栈

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Webpack 5, Tailwind CSS |
| Backend | Fastify 5, TypeScript |
| Database | PostgreSQL, Prisma 6 |
| Agent Runtime | LangGraph, LangChain ChatModel, PostgreSQL checkpointer |
| Auth | Signed session cookie, CSRF token, optional PIN lock |

可对应理解为：

| 层级 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript、Webpack 5、Tailwind CSS |
| 后端 | Fastify 5、TypeScript |
| 数据库 | PostgreSQL、Prisma 6 |
| Agent 运行时 | LangGraph、LangChain ChatModel、PostgreSQL checkpointer |
| 认证 | 签名 Session Cookie、CSRF Token、可选 PIN 锁 |

## 主要能力

- 任务管理，支持增删改查、乐观锁、优先级与截止日期
- 财务记录，支持统计、图表以及面向导出的数据结构
- 知识笔记，支持编辑、搜索与预设标签
- AI Provider 管理，支持 OpenAI 兼容、Anthropic、Gemini 和自定义端点
- Agent 运行历史、工具确认流程以及基于 checkpoint 的恢复

## 运行要求

- Node.js 18+
- npm
- PostgreSQL

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 复制环境变量文件：

```bash
copy .env.example .env
```

3. 至少在 `.env` 中配置以下内容：

- `DATABASE_URL`
- 如果希望自动初始化 Provider，可以补充默认 Provider 相关配置

4. 执行数据库迁移：

```bash
npx prisma migrate deploy
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
npm run typecheck
npm run server:typecheck
npm run build
npm run server:build
npm run server:seed
npm run knowledge:smoke
npm run agent:e2e
npm run knowledge:e2e
npm run agent:modules:e2e
```

## 目录结构

```text
src/                    前端应用
server/                 后端应用
prisma/                 Schema 与迁移
docs/                   架构与迁移说明
scripts/                冒烟测试与 E2E 脚本
dist-server/            后端编译产物
```

重要后端模块：

- `server/src/modules/auth`
- `server/src/modules/tasks`
- `server/src/modules/finance`
- `server/src/modules/knowledge`
- `server/src/modules/providers`
- `server/src/modules/agent`

重要前端区域：

- `src/pages`
- `src/components`
- `src/agent`
- `src/lib`
- `src/store`
- `src/sync`

## Agent 运行时说明

Agent 运行时位于 `server/src/modules/agent/langgraph/`。

当前实现特征：

- LangGraph 是当前唯一的 Agent 执行引擎
- PostgreSQL checkpointer 是运行时状态持久化层
- 只读工具会直接执行
- 写操作工具必须显式确认
- 确认与恢复通过 LangGraph 的 interrupt 与后续恢复执行完成

工具分组：

- 查询类工具：任务、财务、知识搜索、统计
- 写操作工具：创建任务、更新任务、删除任务、添加财务记录

## 安全说明

- 非 `GET` 请求必须携带有效的 CSRF Token
- 签名 Session Cookie 是默认认证路径
- `ALLOW_DEFAULT_USER_FALLBACK=true` 仅适用于本地开发
- 生产环境不要使用默认的 `PROVIDER_SECRET_KEY`

## 当前状态

- 前后端可以在本地正常运行
- 任务、财务、知识库等数据库驱动模块已启用
- Agent 历史记录与 checkpoint 恢复链路已启用
- 当前文档已与 LangGraph 架构基线对齐
