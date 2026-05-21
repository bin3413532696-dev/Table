# 架构说明

本文档描述 `Table` 当前在仓库中的实际应用架构实现。

## 系统总览

`Table` 是一个全栈个人工作台系统，包含：

- React 前端（Webpack dev server :3266）
- Fastify 后端 API（:8787）
- PostgreSQL 作为权威数据源
- LangGraph Agent 运行时（PostgreSQL checkpointer）

高层拓扑：

```text
Browser
  -> Webpack dev server :3266
  -> /api proxy
  -> Fastify API :8787
  -> Prisma
  -> PostgreSQL
```

## 前端

### 入口结构

关键文件：

- `src/index.tsx` - 应用入口，初始化 Provider 树
- `src/App.tsx` - 路由配置，PIN 锁验证
- `src/contexts/ThemeContext.tsx` - 主题管理
- `src/contexts/UserContext.tsx` - 用户状态
- `src/agent/AgentContext.tsx` - Agent 状态管理
- `src/agent/AgentSidebarContext.tsx` - Agent 侧边栏 UI 状态

Provider 树结构：

```tsx
<ThemeProvider>
  <UserProvider>
    <AgentProvider>
      <AgentSidebarProvider>
        <App />
      </AgentSidebarProvider>
    </AgentProvider>
  </UserProvider>
</ThemeProvider>
```

### 路由结构

使用 `HashRouter`，页面级懒加载：

```tsx
<Routes>
  <Route path="/" element={<Layout />}>
    <Route index element={<Navigate to="/dashboard" />} />
    <Route path="dashboard" element={<Dashboard />} />
    <Route path="knowledge" element={<Knowledge />} />
    <Route path="tasks" element={<Tasks />} />
    <Route path="tools" element={<Tools />} />
    <Route path="finance" element={<Finance />} />
    <Route path="settings" element={<Settings />} />
  </Route>
</Routes>
```

### 数据流

**任务与财务模块**：遵循相同模式

1. 用户触发操作 → `src/db/index.ts` 封装请求
2. 后端执行查询/变更 → 响应回填内存 Store
3. UI 通过 Store 监听器刷新

**知识库模块**：直接 API 调用，页面本地状态管理

**Agent 模块**：`AgentContext` 管理状态

- 发送用户消息 → `streamAgentRun` SSE
- 消费事件 → 更新 `messages` / `streamingContent`
- 等待确认 → `confirmAction` / `rejectAction`
- 历史管理 → `loadHistorySession`

### 关键前端区域

- `src/pages/` - 页面组件
- `src/components/Layout/` - 布局框架
- `src/components/Agent/AgentSidebar.tsx` - Agent 侧边栏 UI
- `src/lib/agentApi.ts` - Agent API 封装（SSE 流处理）
- `src/db/index.ts` - CRUD 封装
- `src/store/` - 内存 Store（BaseStore 模式）
- `src/sync/` - 服务端同步引擎

## 后端

### 入口结构

关键文件：

- `server/src/index.ts` - 启动入口，初始化 checkpointer，修复 zombie sessions
- `server/src/app.ts` - Fastify 应用配置，钩子注册
- `server/src/db/client.ts` - Prisma 客户端

后端提供：

- CORS（开发环境允许 localhost:3266）
- 限流（100/min）
- CSRF 验证（非 GET 请求）
- 签名 Session Cookie 认证
- 模块化路由注册
- 集中错误处理

### 模块结构

```text
server/src/modules/
  auth/          - 用户认证、PIN 管理
  tasks/         - 任务 CRUD
  finance/       - 财务记录 CRUD
  knowledge/     - 知识笔记 CRUD
  providers/     - API Provider 配置管理
  agent/         - Agent 运行时
  maintenance/   - 数据导入导出、重置
  health/        - 健康检查
```

每个业务模块遵循五层结构：

- `routes.ts` - 路由定义（try-catch + sendInfrastructureError）
- `schema.ts` - Zod 校验
- `service.ts` - 业务逻辑封装
- `repository.ts` - 数据访问（WHERE 必须含 userId）
- `dto.ts` - 数据转换（可选）

### 共享基础设施

`server/src/shared/`：

- `auth.ts` - 认证、用户初始化、Provider baseline
- `session.ts` - 签名 Session Cookie（HMAC-SHA256）
- `user-context.ts` - AsyncLocalStorage 用户上下文
- `config.ts` - 环境变量配置
- `crypto.ts` - Provider API Key 加密存储
- `http.ts` - HTTP 错误响应封装

### 认证机制

认证基于 Cookie：

1. **签名 Session Cookie**：`<userId>.<expires>.<signature>`
   - 最高优先级，通过 `verifySessionToken` 验证
2. **x-user-id Header**：仅当 `TRUST_USER_ID_HEADER=true` 时信任
3. **默认用户回退**：仅开发环境，`ALLOW_DEFAULT_USER_FALLBACK=true`

CSRF 验证：

- Cookie 存储 `table_dev_csrf_token`
- 非 GET 请求必须携带 `x-csrf-token` header

## 数据库

### Prisma Schema

主要实体：

- `User` - 用户
- `UserSetting` - 用户设置（含 agentPreferencesJson、providerConfigHash）
- `AgentSession` - Agent 会话（新增）
- `AgentRun` - Agent 运行记录
- `ApiProvider` - API Provider 配置
- `Task` - 任务
- `FinanceRecord` - 财务记录
- `KnowledgeNote` - 知识笔记
- `KnowledgePresetTag` - 预设标签

设计要点：

- 业务实体以 `userId` 为作用域
- 可变实体通过 `version` 实现乐观锁
- 外键约束使用 `CASCADE`（删除用户时级联删除）
- 移除软删除（`deletedAt`），改用硬删除
- `AgentSession` 作为 Agent 多轮对话的会话容器
- `AgentRun.sessionId` 必选，关联到 `AgentSession`

### Agent 数据模型

```text
User
  └── AgentSession (1:N)
        └── AgentRun (1:N)

AgentRun:
  - id, userId, sessionId (required)
  - status: 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'cancelled'
  - inputText, model
  - 轻量元数据，完整状态存储在 LangGraph checkpoint
```

## Agent 运行时

### 位置

`server/src/modules/agent/langgraph/`：

- `state.ts` - AgentState Annotation 定义
- `graph.ts` - StateGraph 构建，流式执行
- `tools.ts` - 工具定义与元数据
- `chatModel.ts` - LangChain ChatModel 适配层
- `prompts.ts` - 系统提示与工具结果构建
- `message-manager.ts` - 消息上下文管理（trimMessages）
- `parser.ts` - 工具调用解析（文本兼容模式）
- `postgres-checkpointer.ts` - PostgreSQL checkpointer

### StateGraph 节点

```text
__start__ → init → build_messages → call_model → parse_tools
           ↓
           afterParseRouter → finalize (无工具)
                             → check_confirmation (有工具)

check_confirmation → afterCheckConfirmationRouter
                     → request_confirmation (需确认)
                     → execute_tools (只读工具)

request_confirmation → interrupt → 等待用户
                      → execute_confirmed_tool (确认后)

execute_tools / execute_confirmed_tool → afterExecuteRouter
                                         → finalize (达到 MAX_ITERATIONS)
                                         → build_messages (继续循环)
```

### 执行模式

**直接流式执行**（`streamAgentGraphDirect`）：

- 绕过 LangGraph 内部 stream 消费问题
- 直接调用 LLM 流式 API
- 实时发送 token 到前端
- 处理工具调用循环
- 最终保存到 checkpoint

**关键配置**：

- `MAX_ITERATIONS = 5`（环境变量可覆盖）
- `LLM_TIMEOUT_MS = 180000`（首 token 30s，chunk 60s，总 5min）
- 分段超时：`firstTokenTimeoutMs`, `chunkTimeoutMs`, `totalTimeoutMs`

### 工具策略

**只读工具**（直接执行）：

- `query_tasks` - 查询任务列表
- `get_task_stats` - 任务统计
- `query_finance` - 查询财务记录
- `get_finance_stats` - 财务统计
- `search_knowledge` - 搜索知识库

**写操作工具**（需用户确认）：

- `create_task` - 创建任务
- `update_task` - 更新任务
- `delete_task` - 删除任务
- `add_finance_record` - 新增财务记录

**工具缓存**：`CACHE_TTL_MS = 5000`，减少重复调用

### ChatModel 适配

支持格式：

- `openai` - ChatOpenAI
- `anthropic` - ChatAnthropic
- `gemini` - ChatGoogleGenerativeAI
- `custom` - OpenAI-compatible API

关键特性：

- 使用 `bindTools` 支持原生 Function Calling
- 流式输出：`streamLlmDirect` 直接 token 级输出
- SSRF 防护：验证 baseUrl，阻止内网 IP

### 消息管理

`MessageManager`：

- 根据 model 上下文限制自动修剪消息
- 使用 `trimMessages` + token 估算
- 模型上下文限制表（GPT-4o: 128K, Claude: 200K, Gemini: 128K）
- 使用 80% 作为实际限制

### Checkpoint 持久化

使用 LangGraph PostgreSQL checkpointer：

- `thread_id = sessionId`（多轮对话共享 checkpoint）
- 完整状态存储在 checkpoint（messages, executedToolCalls, timeline）
- `AgentRun` 表仅存储轻量元数据
- Run 详情接口从 checkpoint 重建

## Agent API

### 端点

**健康检查**：

- `GET /api/agent/health` - 运行时状态（connected, selectedModel, provider）

**Persona**：

- `GET /api/agent/persona` - 获取用户人格配置
- `PUT /api/agent/persona` - 更新人格配置

**Session**：

- `GET /api/agent/sessions` - 会话列表
- `GET /api/agent/sessions/:id` - 会话详情（含 checkpoint 消息）
- `POST /api/agent/sessions` - 创建会话
- `PATCH /api/agent/sessions/:id` - 更新会话标题
- `DELETE /api/agent/sessions/:id` - 删除会话及 checkpoint

**Run**：

- `GET /api/agent/runs` - Run 列表
- `GET /api/agent/runs/:id` - Run 详情
- `POST /api/agent/runs` - 创建 Run（非流式）
- `POST /api/agent/runs/stream` - 创建 Run（SSE 流式）
- `PATCH /api/agent/runs/:id` - 更新 Run
- `DELETE /api/agent/runs/:id` - 删除 Run

**工具确认**：

- `POST /api/agent/runs/:id/tools/:toolExecutionId/confirm`
- `POST /api/agent/runs/:id/tools/:toolExecutionId/confirm/stream`
- `POST /api/agent/runs/:id/tools/:toolExecutionId/reject`
- `POST /api/agent/runs/:id/tools/:toolExecutionId/reject/stream`

### SSE 事件

流式接口发送：

- `metadata` - { runId, model, sessionId }
- `token` - { token: string }
- `langgraph_chunk` - { mode: 'messages' | 'tasks', chunk }
- `run_update` - { run: AgentRunDetailDto }
- `run_completed` - { run: AgentRunDetailDto }
- `done` - { ok: true }
- `error` - { message: string }

SSE 配置：

- 心跳：25s
- 总超时：5min
- 前端 AbortController：120s

## Providers

### 数据模型

`ApiProvider`：

- `name` - Provider 名称
- `apiFormat` - 格式类型
- `baseUrl` - API 端点
- `apiKeyEncrypted` - 加密存储的 API Key
- `model` - 默认模型
- `headersJson` - 自定义 headers
- `isActive` - 是否激活
- `source` - 'bootstrap' | 'manual'

### Bootstrap 机制

- `.env` 配置默认 Provider
- 首次启动时自动创建 bootstrap Provider
- 检测配置变更自动同步
- `providerConfigHash` 存储配置哈希

## 安全机制

| 规则 | 要求 |
|------|------|
| 认证 | 签名 Cookie + CSRF Token |
| Provider URL | 仅 HTTPS，阻止内网 IP |
| 输入校验 | Zod schema，必须有长度限制 |
| 数据访问 | WHERE 必须含 userId |
| API Key | AES-256 加密存储 |
| fetch 超时 | AbortController 120s |

## 运行命令

```bash
# 前端
npm run dev          # :3266
npm run build        # 生产构建
npm run typecheck    # 前端类型检查

# 后端
npm run server:dev   # :8787，热重载
npm run server:build # 编译
npm run server:typecheck

# 数据库
npx prisma migrate dev
npx prisma migrate deploy
npx prisma generate
npm run server:seed

# 测试
npm run agent:e2e
npm run knowledge:e2e
npm run agent:modules:e2e
npm run knowledge:smoke
```

## 架构约束与注意事项

1. **Agent sessionId 与 thread_id**：必须一致（sessionId），否则 checkpoint 无法恢复
2. **工具确认流程**：interrupt → 用户确认 → resume → continueAgentGraph
3. **消息修剪**：MessageManager 防止超出模型上下文限制
4. **分段超时**：首 token 30s，后续 chunk 60s，总 5min
5. **流式执行**：使用 `streamAgentGraphDirect` 绕过 LangGraph 内部 stream 消费
6. **软删除已移除**：改用硬删除 + CASCADE 外键