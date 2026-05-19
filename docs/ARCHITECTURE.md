# 架构说明

本文档描述 `Table` 当前在仓库中的实际应用架构实现。

## 系统总览

`Table` 是一个全栈个人工作台系统，包含：

- React 前端
- Fastify 后端
- 作为权威数据源的 PostgreSQL
- 负责 Agent 执行的 LangGraph

高层拓扑如下：

```text
Browser
  -> Webpack dev server :3266
  -> /api proxy
  -> Fastify API :8787
  -> Prisma
  -> PostgreSQL
```

## 前端

## 入口结构

关键文件：

- `src/index.tsx`
- `src/App.tsx`
- `src/contexts/ThemeContext.tsx`
- `src/contexts/UserContext.tsx`
- `src/agent/AgentContext.tsx`

前端当前使用：

- `HashRouter`
- 页面级懒加载
- 仓库内自定义 store 维护内存状态
- 直接封装的带认证 fetch 访问 API

## 主要前端区域

### 页面

- `src/pages/Dashboard`
- `src/pages/Tasks`
- `src/pages/Finance`
- `src/pages/Knowledge`
- `src/pages/Tools`
- `src/pages/Settings`
- `src/pages/AgentHistory`

### 共享 UI

- `src/components/Layout`
- `src/components/ui`
- `src/components/Agent`

### 数据与集成层

- `src/lib/auth.ts`
- `src/lib/agentApi.ts`
- `src/lib/apiConfig.ts`
- `src/db/index.ts`
- `src/store`
- `src/sync`

## 前端数据流

### 任务与财务

任务和财务模块基本遵循同一模式：

1. 用户在页面或组件中触发操作
2. 经由前端 db/api 封装发起请求
3. 后端执行查询或变更
4. 响应回填到内存 store
5. UI 通过 store 监听器刷新

### 知识库

知识库模块更偏向直接走 API：

1. 页面直接调用知识库相关接口
2. 页面本地状态保存响应结果
3. 同步引擎负责部分缓存与拉取行为

### Agent

Agent 前端状态由 `AgentContext` 维护。

核心职责包括：

- 发送用户消息
- 调用创建或流式执行接口
- 消费 SSE 事件
- 把 run 更新映射到助手消息状态
- 暴露确认请求
- 确认或拒绝待执行写操作

## 后端

## 后端入口

关键文件：

- `server/src/index.ts`
- `server/src/app.ts`
- `server/src/db/client.ts`

后端提供：

- CORS
- 限流
- 针对非 `GET` 请求的 CSRF 校验
- 基于签名 Session 的认证
- 模块化路由注册
- 集中的基础设施错误处理

## 模块结构

```text
server/src/modules/
  auth/
  tasks/
  finance/
  knowledge/
  providers/
  agent/
  maintenance/
  health/
```

每个业务模块通常包含：

- `routes.ts`
- `schema.ts`
- `service.ts`
- `repository.ts`
- `dto.ts`

## 共享后端基础设施

重要共享模块：

- `server/src/shared/auth.ts`
- `server/src/shared/session.ts`
- `server/src/shared/user-context.ts`
- `server/src/shared/config.ts`
- `server/src/shared/http.ts`
- `server/src/shared/crypto.ts`

## 认证与请求规则

认证机制基于 Cookie。

关键特征：

- 签名 Session Cookie 是主要身份机制
- 非 `GET` 请求必须带上 CSRF Token
- 默认不信任 `x-user-id`
- 可通过配置启用开发态默认用户回退，但不应在生产环境使用

相关路由：

- `/api/auth/me`
- `/api/auth/users`
- `/api/auth/session`
- `/api/auth/pin`

## 数据库

Prisma Schema 位于 `prisma/schema.prisma`。

主要实体：

- `User`
- `UserSetting`
- `ApiProvider`
- `Task`
- `FinanceRecord`
- `KnowledgeNote`
- `KnowledgePresetTag`
- `AgentRun`

设计要点：

- 业务实体以用户为作用域
- 大多数可变实体通过 `version` 实现乐观锁
- 任务、财务、知识笔记等模块使用了软删除
- `AgentRun` 只保存轻量级业务元数据，不保存完整运行时状态

## Agent 运行时

Agent 运行时位于：

- `server/src/modules/agent/langgraph/state.ts`
- `server/src/modules/agent/langgraph/graph.ts`
- `server/src/modules/agent/langgraph/tools.ts`
- `server/src/modules/agent/langgraph/chatModel.ts`
- `server/src/modules/agent/langgraph/parser.ts`
- `server/src/modules/agent/langgraph/message-manager.ts`
- `server/src/modules/agent/langgraph/postgres-checkpointer.ts`

## Agent 执行模型

当前运行时是一个 LangGraph 工作流，包含这些节点：

1. `init`
2. `build_messages`
3. `call_model`
4. `parse_tools`
5. `check_confirmation`
6. `execute_tools`
7. `request_confirmation`
8. `execute_confirmed_tool`
9. `finalize`

路由行为如下：

- 没有工具调用时，直接 `finalize`
- 只读工具调用时，直接执行
- 写操作工具调用时，暂停等待用户确认
- 写操作确认后，恢复并继续执行

## Agent 工具策略

只读工具：

- `query_tasks`
- `get_task_stats`
- `query_finance`
- `get_finance_stats`
- `search_knowledge`

需要确认的写操作工具：

- `create_task`
- `update_task`
- `delete_task`
- `add_finance_record`

## Agent 持久化

运行时持久化基于 LangGraph 的 PostgreSQL checkpoint。

这意味着：

- 完整运行时状态不会再手动镜像到自定义快照表
- run 元数据保存在 `agent_runs`
- checkpoint 相关表保存可恢复的图状态
- run 详情接口会从 checkpoint 状态重建历史信息

## Agent API 面

主要接口：

- `GET /api/agent/health`
- `GET /api/agent/runs`
- `POST /api/agent/runs`
- `POST /api/agent/runs/stream`
- `GET /api/agent/runs/:id`
- `DELETE /api/agent/runs/:id`
- `PATCH /api/agent/runs/:id`
- `POST /api/agent/runs/:id/tools/:toolExecutionId/confirm`
- `POST /api/agent/runs/:id/tools/:toolExecutionId/confirm/stream`
- `POST /api/agent/runs/:id/tools/:toolExecutionId/reject`
- `POST /api/agent/runs/:id/tools/:toolExecutionId/reject/stream`

## SSE 行为

流式接口会发送以下结构化事件：

- metadata
- run update
- graph chunk
- run completed

前端消费这些事件后，会增量更新 Agent 面板状态。

## Providers

Provider 配置由用户管理，存储在 `api_providers` 表中。

支持格式：

- `openai`
- `anthropic`
- `gemini`
- `custom`

后端会在实例化模型前校验 Provider URL 的安全性。

## 运维维护

维护路由限定在默认用户上下文内，包含：

- 业务快照导出
- 业务快照导入
- 作用域数据重置

这些接口主要用于受控的本地维护与恢复操作。

## 构建与运行说明

前端：

- `npm run dev`
- `npm run build`

后端：

- `npm run server:dev`
- `npm run server:build`
- `npm run server:typecheck`

验证脚本：

- `npm run knowledge:smoke`
- `npm run agent:e2e`
- `npm run knowledge:e2e`
- `npm run agent:modules:e2e`

## 当前架构约束

- 部分源码文件的注释或用户可见字符串仍残留历史编码损坏
- Agent 工具调用当前仍依赖模型输出文本解析，而不是模型原生结构化工具调用
- 仓库中存在若干与当前任务无关的未提交改动，后续更新文档时仍需谨慎对照真实代码
