# 项目架构文档

## 项目整体架构概览

这是一个 **全栈个人工作空间应用**（名为 `personal-workspace`），采用经典的 **前后端分离** 架构模式。

### 技术栈选择

| 层次 | 技术 | 选择理由 |
|------|------|----------|
| 前端框架 | React 18 + TypeScript | 类型安全、生态成熟、社区活跃 |
| 前端构建 | Webpack 5 | 灵活的代码分割、资源管理 |
| 后端框架 | Fastify 5 | 高性能、低开销、内置 JSON 支持 |
| ORM | Prisma 6 | 类型安全的数据库访问、自动迁移 |
| 数据库 | PostgreSQL | 支持全文搜索、事务、JSON 字段 |
| 状态管理 | 自定义 Store + EventEmitter | 轻量级、可控性强 |
| 表单验证 | Zod | 类型安全的运行时验证 |
| 富文本编辑 | TipTap | 可扩展的 ProseMirror 封装 |
| UI 动画 | Framer Motion | 声明式动画、手势支持 |

---

## 为什么要这样构建？

### 1. 前后端分离架构

**设计意图**：将用户界面（前端）和业务逻辑（后端）完全解耦

**带来的好处**：
- 前端可以独立开发和部署（静态资源托管）
- 后端 API 可以被多个客户端复用（Web、移动端等）
- 技术栈可以独立演进（前端用 React，后端用 Node.js）
- 便于水平扩展（前端 CDN + 后端多实例）

**架构图**：
```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (Browser)                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐   │
│  │ React   │  │ Store   │  │ db/     │  │ SyncEngine  │   │
│  │ 组件    │  │ 内存缓存│  │ API客户端│  │ 知识库同步  │   │
│  └────┬────┘  └────┬────┘  └────┬────┘  └──────┬──────┘   │
└───────┼────────────┼────────────┼───────────────┼──────────┘
        │            │            │               │
        ▼            │            ▼               │
┌─────────────────────────────────────────────────┼──────────┐
│              Webpack Dev Server                 │          │
│           (端口: 3266)                          │          │
│              /api/* → Proxy → :8787             │          │
└──────────────────────────┬──────────────────────┼──────────┘
                           ▼                      │
┌─────────────────────────────────────────────────┼──────────┐
│                      后端 (Fastify)             │          │
│           (端口: 8787)                          │          │
│  ┌───────────────┐  ┌───────────────┐          │          │
│  │   Modules     │  │   Shared      │          │          │
│  │ (业务模块)    │  │ (通用工具)    │          │          │
│  └───────┬───────┘  └───────┬───────┘          │          │
│          │                  │                   │          │
│          ▼                  ▼                   │          │
│  ┌───────────────┐  ┌───────────────┐          │          │
│  │   Repository  │  │   Prisma      │◄─────────┘          │
│  │ (数据访问层)  │  │   Client      │                     │
│  └───────┬───────┘  └───────┬───────┘                     │
│          │                  │                             │
│          └──────────────────┼─────────────────────────────┘
│                             ▼                             │
│                    PostgreSQL                             │
└────────────────────────────────────────────────────────────┘
```

---

## 前端架构详解

### 目录结构

```
src/
├── agent/                # 智能体前端状态管理
│   ├── AgentContext.tsx   # React Context + useReducer
│   ├── types.ts          # AgentState, ToolCall 等
│   └── toolMetadata.ts   # 工具显示元数据
├── components/           # UI 组件
│   ├── Agent/            # AI 助手（AgentTrigger 浮窗按钮 + AgentPanel 面板）
│   ├── Layout/           # 布局（Sidebar 256px + Header）
│   └── ui/               # 基础组件（Button, Card, Toggle, EmptyState, VirtualList）
├── contexts/             # React Context
│   ├── ThemeContext.tsx   # 主题（light/dark），持久化到 localStorage
│   └── UserContext.tsx    # 当前用户与认证状态
├── core/                 # 核心基础设施
│   ├── errors/           # AppError 类 + ErrorHandler 单例 + ErrorCode 枚举
│   ├── events/           # EventEmitter 全局事件总线 + EventTopics 定义
│   ├── types/            # BaseEntity, FinanceRecord, Task 等共享类型
│   ├── validation/       # 运行时验证器（isValidAmount, isValidTask 等）
│   └── messages.ts       # 用户-facing 中文消息字典
├── db/                   # 数据访问层（关键桥梁）
│   └── index.ts          # financeDB / taskDB / dataManager / createUseDB hook
├── lib/                  # 工具函数和 API 封装
│   ├── auth.ts           # fetchWithAuth（Cookie 认证）、PIN 管理、用户切换
│   ├── apiConfig.ts      # AI Provider CRUD、providerCache、活跃配置选择
│   ├── agentApi.ts       # Agent Run API（含 SSE 流式解析）
│   └── dataSync.ts       # 同步生命周期封装
├── pages/                # 页面组件（全部 lazy-loaded）
│   ├── Dashboard/        # 仪表盘（任务/财务统计卡片）
│   ├── Knowledge/        # 知识库（TipTap 编辑器、标签管理、直接调 API）
│   ├── Tasks/            # 任务管理（搜索、过滤、批量操作、内联编辑）
│   ├── Finance/          # 财务管理（Recharts 图表、CSV 导出、批量操作）
│   ├── Tools/            # 工具箱（计算器、取色器、JSON 格式化，纯客户端）
│   ├── Settings/         # 设置（Profile/Security/Data/API Config 四个 Tab）
│   └── AgentHistory/     # 智能体运行历史
├── store/                # 内存状态缓存
│   ├── base/Store.ts     # BaseStore<T> 抽象基类（CRUD + 事件发射）
│   └── impl/             # FinanceStore / TaskStore 单例（localStorage 已禁用）
├── sync/                 # 数据同步引擎
│   ├── SyncEngine.ts     # 单例，1500ms 防抖，仅处理 knowledge 类型
│   └── config.ts         # 同步常量与类型
├── App.tsx               # 根组件（HashRouter + PIN 锁屏 + AgentTrigger）
└── index.tsx             # 入口（Provider 嵌套：ErrorBoundary > Theme > User > Agent > App）
```

### 核心数据流

**任务/财务的完整数据流**（服务端权威）：

```
用户操作 → financeDB.add() → fetchWithAuth(POST /api/finance)
                                    ↓
                              后端处理 + PostgreSQL
                                    ↓
                              返回 {data, source}
                                    ↓
                         hydrateFinanceCache() → 更新内存 Store
                                    ↓
                         eventEmitter.emit(FINANCE_CHANGED)
                                    ↓
                         useDB hook 重新 fetch → 组件重渲染
```

关键点：
- **Store 是纯内存缓存**，localStorage 持久化已禁用（storageKey 含 `_cache_disabled`）
- **所有写操作直走服务端 API**，成功后 hydrate 到 Store 并发射事件
- **`createUseDB` hook** 是页面与数据层的桥梁：mount 时 fetch，收到 change 事件时重新 fetch

**知识库的数据流**（独立路径）：

```
Knowledge 页面 → 直接 fetchWithAuth(/api/knowledge/notes)
                      ↓
              页面内部 useState 管理，不经过 Store 层
                      ↓
              SyncEngine 负责 1500ms 防抖拉取 + localStorage 缓存
```

### 认证与 PIN 锁

```
App.tsx mount
    ↓
fetchPinStatus() → PIN 是否已设置？
    ↓ 是
PinLock 组件 → 用户输入 6 位 PIN
    ↓
verifyPinApi() → 后端 scrypt 验证
    ↓ 成功
后端签发 HMAC-SHA256 签名 Cookie（24h 有效）
    ↓
前端 fetchWithAuth 自动携带 Cookie（credentials: 'same-origin'）
```

- 未设置 PIN 时，使用裸 UUID Cookie 兼容路径
- `x-user-id` 头不再由前端发送（`buildAuthenticatedHeaders` 已清空）
- 用户切换通过 `switchAuthSession()` 端点，同样签发签名 Cookie

### 智能体前端架构

```
AgentContext (useReducer)
    │
    ├── sendMessage(content)
    │       ↓
    │   createAgentRun(inputText) → POST /api/agent/runs
    │       ↓
    │   applyRunResultToAssistantMessage() → dispatch ADD_MESSAGE
    │
    ├── 工具确认流程
    │       ↓
    │   status === 'waiting_confirmation'
    │       ↓
    │   存储 ConfirmationRequest → UI 显示确认按钮
    │       ↓
    │   confirmAction() → POST /api/agent/runs/:id/tools/:execId/confirm
    │   rejectAction() → POST /api/agent/runs/:id/tools/:execId/reject
    │
    └── 连接状态
            ↓
        checkConnection() → GET /api/agent/health（30s 轮询）
            ↓
        监听 API_CONFIG_CHANGED_EVENT 重新检查
```

历史消息裁剪：`MAX_HISTORY_MESSAGES = 50`，`MAX_CONTEXT_CHARS = 50000`

### 路由表

| 路径 | 页面 | 数据源 |
|------|------|--------|
| `/dashboard` | Dashboard | `useDB` → taskDB + financeDB |
| `/knowledge` | Knowledge | 直接 `fetchWithAuth` |
| `/tasks` | Tasks | `useDB` → taskDB |
| `/finance` | Finance | `useDB` → financeDB |
| `/tools` | Tools | 纯客户端，无 API |
| `/settings` | Settings | fetchWithAuth + dataManager |
| `/agent-history` | AgentHistory | GET /api/agent/runs |

使用 `HashRouter`（URL 格式 `/#/dashboard`），所有页面 `React.lazy()` 按需加载。

### Webpack 代码分割

| 缓存组 | 内容 | 优先级 |
|--------|------|--------|
| `react-vendor` | React 核心 | 30 |
| `chart-vendor` | Recharts + D3 | 25 |
| `animation-vendor` | Framer Motion | 20 |
| `vendor` | 其他 node_modules | 10 |

---

## 后端架构详解

### 目录结构

```
server/
├── src/
│   ├── modules/          # 业务模块 (按功能划分)
│   │   ├── agent/        # 智能体运行时
│   │   │   ├── langgraph/ # LangGraph 执行引擎（state/graph/tools/parser/chatModel/message-manager/postgres-checkpointer）
│   │   │   ├── service.ts # 业务服务层
│   │   │   ├── routes.ts  # REST + SSE 端点
│   │   │   ├── repository.ts # 数据访问层
│   │   │   ├── schema.ts  # Zod 验证
│   │   │   └── dto.ts     # DTO 转换
│   │   ├── auth/         # 认证（PIN 验证、会话切换、用户管理）
│   │   ├── finance/      # 财务管理
│   │   ├── health/       # 健康检查
│   │   ├── knowledge/    # 知识库（笔记 + 预设标签）
│   │   ├── maintenance/  # 维护操作（快照导入/导出/重置）
│   │   ├── providers/    # AI Provider 配置管理
│   │   └── tasks/        # 任务管理
│   ├── shared/           # 共享工具
│   │   ├── auth.ts       # 认证中间件、基线初始化、baselineReadyUsers
│   │   ├── config.ts     # Zod 校验的环境变量配置
│   │   ├── session.ts    # HMAC-SHA256 签名令牌（signSessionToken / verifySessionToken）
│   │   ├── user-context.ts # AsyncLocalStorage 用户上下文（resolveRequestUserContext）
│   │   └── http.ts       # sendInfrastructureError 等 HTTP 工具
│   ├── db/
│   │   └── client.ts     # Prisma 全局单例（连接池 20、timeout 10s）
│   ├── app.ts            # Fastify 应用（CORS、速率限制、全局钩子、错误处理）
│   └── index.ts          # 入口（启动、优雅关闭、全局异常处理）
└── prisma/
    ├── schema.prisma     # 数据模型定义
    ├── seed.js           # 种子数据
    └── migrations/       # SQL 迁移文件
```

### 每个模块的内部结构（以 tasks 为例）

```
modules/tasks/
├── routes.ts      # 路由定义 (API 端点 + Zod 参数校验)
├── service.ts     # 业务逻辑层（所有权检查、版本冲突检测）
├── repository.ts  # 数据访问层 (Prisma CRUD，WHERE 含 userId)
├── schema.ts      # 请求/响应 Schema (Zod，含 .max() 长度限制)
└── dto.ts         # 实体到响应格式转换
```

**注意**：并非所有模块都遵循完整的 5 层结构：

| 模块 | 分层情况 |
|------|----------|
| tasks / finance / knowledge / agent | 完整 5 层 + agent 含 LangGraph 子模块 |
| providers | 缺 repository.ts、dto.ts（复用共享仓储） |
| maintenance | 缺 repository.ts、schema.ts（纯服务层） |
| auth / health | 薄路由模块，仅 routes.ts（内置于 app.ts 钩子） |

**架构分层说明**：

| 层次 | 职责 | 文件 |
|------|------|------|
| **路由层** | 处理 HTTP 请求/响应、参数校验 | `routes.ts` |
| **服务层** | 业务逻辑、所有权检查、事务管理 | `service.ts` |
| **仓储层** | 数据库 CRUD（WHERE 含 userId） | `repository.ts` |
| **Schema层** | 输入/输出数据验证（含长度/范围约束） | `schema.ts` |
| **DTO层** | 实体到响应格式转换 | `dto.ts` |

**请求处理流程**：

```
HTTP Request
    │
    ▼
app.ts onRequest 钩子 → authenticateRequest → resolveRequestUserContext
    │
    ▼
routes.ts (路由匹配 + Zod schema 校验)
    │
    ▼
service.ts (业务逻辑：所有权检查、版本冲突检测)
    │
    ▼
repository.ts (Prisma 操作，WHERE 含 userId + version)
    │
    ▼
Prisma Client → PostgreSQL
```

### 各模块 API 端点一览

#### 认证模块 (`/api/auth`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/me` | 获取当前用户信息 |
| GET | `/users` | 列出所有用户 |
| PATCH | `/me` | 更新当前用户 |
| POST | `/users` | 创建用户 |
| POST | `/session/switch` | 切换会话（签发签名 Cookie） |
| POST | `/session/clear` | 清除会话 |
| GET | `/pin/status` | PIN 是否已设置 |
| POST | `/pin/verify` | 验证 PIN（签发签名 Cookie） |
| POST | `/pin/set` | 设置 PIN |
| POST | `/pin/clear` | 清除 PIN |

#### 任务模块 (`/api/tasks`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 列出任务（排除软删除） |
| POST | `/` | 创建任务 |
| GET | `/:id` | 获取任务详情 |
| PATCH | `/:id` | 更新任务（乐观锁 version） |
| DELETE | `/:id` | 软删除任务 |

#### 财务模块 (`/api/finance`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 列出财务记录 |
| POST | `/` | 创建财务记录 |
| GET | `/stats` | 财务统计 |
| GET | `/model-stats` | 按模型统计 |
| GET | `/:id` | 获取详情 |
| PATCH | `/:id` | 更新（乐观锁） |
| DELETE | `/:id` | 软删除 |

#### 知识库模块 (`/api/knowledge`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/notes` | 搜索笔记（全文搜索 + 标签过滤） |
| POST | `/notes` | 创建笔记 |
| GET | `/notes/:id` | 获取详情 |
| PATCH | `/notes/:id` | 更新笔记 |
| DELETE | `/notes/:id` | 删除笔记 |
| GET | `/tags` | 获取所有标签 |
| GET | `/tags/preset` | 列出预设标签 |
| POST | `/tags/preset` | 创建预设标签 |
| PATCH | `/tags/preset/:id` | 更新预设标签 |
| DELETE | `/tags/preset/:id` | 删除预设标签 |

#### Provider 模块 (`/api/providers`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 列出所有 Provider |
| POST | `/` | 创建 Provider（API Key AES 加密存储） |
| GET | `/:id` | 获取详情 |
| PATCH | `/:id` | 更新 |
| DELETE | `/:id` | 软删除 |

#### 智能体模块 (`/api/agent`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 运行时状态（Provider 连接、可用模型） |
| GET | `/runs` | 列出运行记录 |
| POST | `/runs` | 创建非流式运行 |
| POST | `/runs/stream` | 创建 SSE 流式运行 |
| GET | `/runs/:id` | 获取运行详情 |
| POST | `/runs/:id/messages` | 追加消息 |
| POST | `/runs/:id/tools` | 列出工具执行 |
| POST | `/runs/:id/tools/:toolExecId/confirm` | 确认工具执行 |
| POST | `/runs/:id/tools/:toolExecId/reject` | 拒绝工具执行 |

#### 维护模块 (`/api/maintenance`)

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/business-snapshot` | 导出业务快照 | defaultUserOnly |
| POST | `/business-snapshot` | 导入业务快照（自动备份） | defaultUserOnly + 1min 速率限制 |
| POST | `/reset` | 重置工作台数据 | defaultUserOnly + 1min 速率限制 |

### 认证机制

**用户身份识别流程**（`resolveRequestUserContext`）：

```
请求到达
    ↓
1. 检查签名 Cookie（table_dev_session_user_id）
   ├─ 格式：<userId>.<expiresTimestamp>.<hmacSignature>
   ├─ 验证：HMAC-SHA256 + 时效检查
   └─ 通过 → 返回 { userId, source: 'signed_session' }
    ↓ 未通过
2. 检查 x-user-id 头
   ├─ 受 TRUST_USER_ID_HEADER 控制（默认 false）
   └─ 通过 → 返回 { userId, source: 'header' }
    ↓ 未通过
3. 检查裸 UUID Cookie
   └─ 存在 → 返回 { userId, source: 'session' }（未设 PIN 的兼容路径）
    ↓ 不存在
4. 回退默认用户
   └─ 返回 { userId: DEFAULT_USER_ID, source: 'missing' }
```

**PIN 验证与令牌签发**：

- 用户提交 PIN → 后端用 scrypt 哈希验证
- 验证通过后签发 HMAC-SHA256 签名 Cookie，有效期 24 小时
- 签名密钥复用 `PROVIDER_SECRET_KEY`（SHA-256 派生）
- 前端 `fetchWithAuth` 不发送 `x-user-id` 头，依赖 Cookie 认证

**为什么这样设计？**
- **防冒充**：签名 Cookie 不可篡改，`x-user-id` 头默认不受信任
- **统一认证**：所有请求经过 `onRequest` 钩子统一处理
- **权限隔离**：Repository WHERE 条件含 `userId`，自动过滤当前用户数据
- **兼容性**：未设 PIN 时裸 UUID Cookie 仍可工作

### 智能体执行器架构（LangGraph）

```
server/src/modules/agent/langgraph/
├── state.ts            # AgentStateAnnotation 状态定义
├── graph.ts            # StateGraph 图结构定义
├── tools.ts            # LangChain Tool 工具定义（9个）
├── parser.ts           # 工具调用解析（支持 tool/json 代码块和内联 JSON）
├── chatModel.ts        # ChatModel 适配层（Anthropic/OpenAI/Gemini/Custom）
├── message-manager.ts   # 消息裁剪与上下文控制
├── postgres-checkpointer.ts # PostgreSQL checkpointer
├── prompts.ts          # 系统提示模板
└── index.ts            # 模块导出
```

**LangGraph 流程图**：

```
init_node → build_messages → call_model → parse_tools
                                            ↓
                                     check_confirmation
                                     ├─ [需确认] → request_confirmation → END
                                     └─ [无需确认] → execute_tools → build_messages
                                                              ↓
                                                        should_continue
                                                        ├─ [继续] → call_model
                                                        └─ [结束] → finalize
```

**关键设计**：
- 查询类工具并行执行（5秒 TTL 缓存）
- 写操作工具使用 `interrupt()` 暂停等待用户确认
- 状态持久化由 LangGraph PostgreSQL checkpointer 负责
- SSE 流式响应兼容现有前端格式
- 最大迭代次数 `MAX_AGENT_ITERATIONS=5`

**工具注册表**（`tools.ts`）：

| 工具名 | 类型 | 需确认 |
|--------|------|--------|
| `query_tasks` | 查询 | 否 |
| `get_task_stats` | 查询 | 否 |
| `query_finance` | 查询 | 否 |
| `get_finance_stats` | 查询 | 否 |
| `search_knowledge` | 查询 | 否 |
| `create_task` | 写操作 | 是 |
| `add_finance_record` | 写操作 | 是 |
| `update_task` | 写操作 | 是 |
| `delete_task` | 写操作 | 是 |

### 全局中间件与钩子

**`app.ts` 配置**：

| 配置 | 说明 |
|------|------|
| CORS | 开发环境允许 `localhost:3266`，生产环境关闭 |
| 速率限制 | 全局 100 次/分钟，无 localhost 白名单 |
| onRequest 钩子 | 全局认证（健康检查和 Agent 健康检查免认证） |
| onResponse 钩子 | 请求日志（敏感字段脱敏：apiKey, pin, token 等） |
| 错误处理器 | 409 版本冲突特殊处理，其他统一 sendInfrastructureError |

**`index.ts` 启动与关闭**：

| 处理器 | 说明 |
|--------|------|
| SIGTERM / SIGINT | 优雅关闭：`app.close()` → `prisma.$disconnect()` |
| unhandledRejection | 记录日志 → 优雅关闭 |
| uncaughtException | 记录日志 → 优雅关闭 |

---

## 数据模型

### 实体关系图

```
User (1) ──────────── (N) AgentRun
  │                         │
  ├─── (1:1) UserSetting    ├─── (N) LangGraph checkpoints
  ├─── (N) ApiProvider      ├─── (N) LangGraph checkpoint blobs
  ├─── (N) Task             └─── (N) LangGraph checkpoint writes
  ├─── (N) FinanceRecord
  ├─── (N) KnowledgeNote
  └─── (N) KnowledgePresetTag
```

### 核心模型字段

| 模型 | 关键字段 | 软删除 | 特殊机制 |
|------|----------|--------|----------|
| **User** | id, name, status(active/disabled) | 否 | 默认用户 UUID 硬编码 |
| **Task** | title(@db.VarChar(200)), priority(low/medium/high), dueDate, notes(@db.VarChar(5000)), version | deletedAt | 乐观锁 version |
| **FinanceRecord** | type(income/expense), amount(@db.Decimal(16,2) ≤999999999.99), category(≤100), recordDate, version | deletedAt | 乐观锁 version |
| **KnowledgeNote** | title(@db.VarChar(200)), content(@db.Text), tagsJson(JSON数组) | deletedAt | 全文搜索 GIN 索引 |
| **KnowledgePresetTag** | name(≤50), color(≤7), sortOrder(0-9999) | 否 | — |
| **ApiProvider** | name, apiFormat, baseUrl, apiKeyEncrypted(AES), model, isActive | deletedAt | API Key AES-256-GCM 加密 |
| **AgentRun** | status(pending/running/waiting_confirmation/completed/failed/cancelled) | 否 | 元数据记录 |

### 数据库迁移历史

| 迁移 | 说明 |
|------|------|
| `20260504_initial_foundation` | 核心表：users, user_settings, api_providers, tasks, finance_records |
| `20260504_knowledge_authority` | knowledge_bases 表 |
| `20260504_knowledge_structured_storage` | 知识图谱表：entities, documents, relations, assertions |
| `20260505_agent_runtime_foundation` | 智能体运行时：agent_runs |
| `20260518_agent_checkpointer_migration` | LangGraph checkpoints, checkpoint_blobs, checkpoint_writes |
| `20260505_knowledge_ontology_tables` | 本体：classes 和 relations |
| `20260505_projection_outbox` | 事件溯源 outbox 表 |
| `20260505_search_fts_indexes` | 全文搜索 GIN 索引 |

> **注意**：`knowledge_ontology_classes`、`knowledge_ontology_relations` 表存在于迁移中但未建模于 `schema.prisma`，存在 schema 漂移。

---

## 环境变量配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `SERVER_HOST` | string | `127.0.0.1` | 服务绑定地址 |
| `SERVER_PORT` | number | `8787` | 服务端口 |
| `DATABASE_URL` | string | `postgresql://postgres:postgres@127.0.0.1:5432/table_dev` | 数据库连接串 |
| `ALLOW_DEFAULT_USER_FALLBACK` | boolean | `false` | 允许回退到默认用户 |
| `TRUST_USER_ID_HEADER` | boolean | `false` | 信任 x-user-id 头（默认关闭） |
| `DEFAULT_USER_ID` | uuid | `00000000-0000-0000-0000-000000000001` | 默认用户 UUID |
| `PROVIDER_SECRET_KEY` | string | `table-dev-provider-secret-key-change-me` | API Key 加密密钥 + 签名密钥（≥16字符） |
| `DEFAULT_PROVIDER_NAME` | string | `GLM-5 Provider` | 默认 AI Provider 名称 |
| `DEFAULT_PROVIDER_FORMAT` | enum | `openai` | 默认格式：openai/anthropic/gemini/custom |
| `DEFAULT_PROVIDER_BASE_URL` | string | `''` | 默认 Provider API 地址 |
| `DEFAULT_PROVIDER_API_KEY` | string | `''` | 默认 Provider API Key |
| `DEFAULT_PROVIDER_MODEL` | string | `''` | 默认模型名称 |
| `PROJECTION_OUTBOX_POLL_MS` | number | `1500` | Outbox 轮询间隔 |
| `PROJECTION_OUTBOX_BATCH_SIZE` | number | `20` | Outbox 批次大小（≤100） |
| `MAX_AGENT_ITERATIONS` | number | `5` | Agent 最大迭代次数 |

---

## 构建和部署

### NPM 脚本

| 脚本 | 命令 | 说明 |
|------|------|------|
| `dev` | `webpack serve` | 前端开发服务器（端口 3266） |
| `build` | `webpack --mode production` | 前端生产构建 |
| `typecheck` | `tsc --noEmit` | 前端类型检查 |
| `server:dev` | `node server/dev-server.js` | 后端开发服务器 |
| `server:build` | `tsc -p tsconfig.server.json` | 后端 TypeScript 编译 |
| `server:typecheck` | `tsc -p tsconfig.server.json --noEmit` | 后端类型检查 |
| `server:seed` | `node server/scripts/seed.js` | 数据库种子数据 |
| `agent:e2e` | `node scripts/e2e/agent-e2e-cdp.mjs` | Agent E2E 测试 |
| `knowledge:e2e` | `node scripts/e2e/knowledge-notes-e2e-cdp.mjs` | 知识库 E2E 测试 |

### LangGraph 新增依赖

```json
{
  "dependencies": {
    "@langchain/langgraph": "^0.2.x",
    "@langchain/core": "^0.3.x",
    "@langchain/anthropic": "^0.3.x",
    "@langchain/openai": "^0.3.x",
    "@langchain/google-genai": "^0.1.x"
  }
}
```

### Webpack 配置要点

| 配置项 | 说明 |
|--------|------|
| 入口 | `src/index.tsx` |
| 输出 | `dist/`，生产环境 content hash |
| Babel | @babel/preset-react（automatic runtime）+ preset-env + preset-typescript |
| CSS | style-loader + css-loader + postcss-loader（Tailwind） |
| 开发代理 | `/api/*` → `http://127.0.0.1:8787` |
| 模块黑名单 | sharp、onnxruntime-node/web 设为 false |
| 路由 | HashRouter，historyApiFallback |

### Prisma 工作流

```bash
npx prisma generate      # 生成 Prisma Client
npx prisma migrate deploy # 应用迁移
npx prisma studio         # 可视化数据库管理
```

---

## 核心设计原则

| 原则 | 在项目中的体现 |
|------|----------------|
| **单一职责** | 每个文件/模块只负责一个功能 |
| **关注点分离** | 前端/后端分离、UI/业务逻辑分离、路由/服务/仓储分层 |
| **服务端权威** | 所有写操作走 API，Store 仅作内存缓存，SyncEngine 服务端拉取 |
| **乐观锁** | Task/Finance 更新使用 version 字段防并发冲突 |
| **安全纵深** | 签名 Cookie + preHandler 权限检查 + Repository userId 过滤 + Zod 输入校验 |
| **优雅降级** | 未设 PIN 时裸 UUID Cookie 兼容、Provider 无响应 120s 超时 |

---

## 已知问题与注意事项

1. **Schema 漂移**：`knowledge_bases`、`knowledge_entities` 等表存在于迁移中但未建模于 `schema.prisma`，seed 脚本引用了不存在的模型
2. **零测试覆盖**：项目无自动化测试文件，所有变更依赖手动验证
3. **SyncEngine 有限**：仅处理 knowledge 类型同步，finance/task 无后台同步（每次操作直走 API）
4. **单用户设计**：当前面向单用户本地使用，多用户场景下 `baselineReadyUsers` 等内存结构需重新评估
