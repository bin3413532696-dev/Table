# 迁移 Agent 架构到 LangGraph Checkpointer（完全重构）

> 说明：本文档为迁移过程记录，保留少量旧表名仅用于说明迁移前后差异；当前实现以 `server/src/modules/agent/langgraph/` 与 `prisma/schema.prisma` 为准。

## Context

当前项目虽然导入了 LangGraph，但实际存在**两套并行的执行架构**：

1. **`graph.ts`**: 定义了完整的 LangGraph StateGraph，**但从未被调用**
2. **`graph.ts` + `postgres-checkpointer.ts`**: 实际使用的执行器，已直接使用 LangGraph + PostgreSQL checkpointer

这导致：
- `agentGraph` 定义了但从未执行（commit `24fa4d10` 只完成了 graph 定义）
- 状态持久化是手动调用 `saveStateSnapshot()`，只在 run 完成后调用 2 次
- 中间迭代状态不保存，中断后只能恢复到上一个 `waiting_confirmation` 点
- LangGraph 内置的 `interrupt`、`checkpointer` 机制完全未使用

**目标**：完全重构 Agent 持久化层，使用 LangGraph 官方 PostgreSQL Checkpointer 作为唯一状态存储，移除旧的 Agent 相关表。

**用户决策**：
- ✅ 不需要数据迁移，直接重建
- ✅ 功能范围允许调整
- ✅ 使用极简方案（保留 AgentRun 元数据表 + LangGraph checkpoints 表）

---

## 重构后架构

### 1. 数据库表结构（极简）

**删除的表**：
- `agent_messages` — 已删除
- `agent_run_state_snapshots` — 已删除
- `tool_executions` — 已删除

**保留的表**：
```prisma
// 极简 AgentRun 元数据表（只存业务相关元数据）
model AgentRun {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  sessionId    String?  @map("session_id") @db.Uuid
  status       String   // 'pending' | 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'cancelled'
  inputText    String   @map("input_text")
  model        String
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  version      Int      @default(1)

  @@index([userId, status])
  @@index([userId, createdAt(sort: Desc)])
  @@map("agent_runs")
}
```

**LangGraph 官方 checkpoint 表**（由 PostgresSaver.setup() 自动创建）：
```sql
CREATE TABLE checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE checkpoint_blobs (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob BYTEA NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
```

**关联关系**：`AgentRun.id` = `checkpoints.thread_id`

### 2. AgentState 扩展（存储完整历史）

```typescript
// langgraph/state.ts - 扩展以存储完整执行历史
export const AgentStateAnnotation = Annotation.Root({
  // 输入
  inputText: Annotation<string>,
  initialMessages: Annotation<...>,

  // Provider
  provider: Annotation<ProviderConfig>,
  model: Annotation<string>,
  systemPrompt: Annotation<string>,

  // 对话历史（checkpoint 后可完整恢复）
  messages: Annotation<ConversationMessage[]>,

  // 工具执行记录
  executedToolCalls: Annotation<ExecutedToolCall[]>,
  pendingToolCalls: Annotation<ToolCall[]>,

  // 确认状态
  requiresConfirmation: Annotation<boolean>,
  pendingToolExecution: Annotation<PendingToolExecution | null>,
  confirmedToolCall: Annotation<ToolCall | null>,

  // 输出
  finalText: Annotation<string>,

  // 元数据
  runId: Annotation<string>,
  userId: Annotation<string>,
  iterationCount: Annotation<number>,
  status: Annotation<RunStatus>,
  error: Annotation<string | null>,
  assistantTextChunks: Annotation<string[]>,

  // 新增：执行时间线（用于前端展示）
  timeline: Annotation<TimelineEvent[]>,
});

// 类型定义
interface TimelineEvent {
  type: 'llm_start' | 'llm_end' | 'tool_start' | 'tool_end' | 'confirmation' | 'interrupted';
  timestamp: string;
  data: Record<string, unknown>;
}
```

### 3. 执行流程

```
用户发起请求
  └─ AgentRun 创建（status: 'pending'）
  └─ agentGraph.invoke(initialState, { configurable: { thread_id: runId } })
       ├─ checkpointer.put() 在每个节点后自动保存 checkpoint
       ├─ 遇中断 → 返回 { status: 'waiting_confirmation' }
       └─ 完成 → 返回 { status: 'completed' }

用户确认工具
  └─ agentGraph.getState({ configurable: { thread_id: runId } }) 获取状态
  └─ agentGraph.invoke(null, { configurable: { thread_id: runId } }) 恢复执行
```

---

## 实现步骤

### Phase 1: 安装依赖 + 数据库迁移

**新增依赖**：
```bash
npm install @langchain/langgraph-checkpoint-postgres pg
```

**数据库迁移脚本** (`prisma/migrations/20260518_agent_checkpointer_migration/`):
```sql
-- 1. 创建 LangGraph checkpoint 表
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_blobs (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob BYTEA NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

-- 2. 删除旧表（迁移完成后）
DROP TABLE IF EXISTS agent_messages;
DROP TABLE IF EXISTS agent_run_state_snapshots;
DROP TABLE IF EXISTS tool_executions;
```

**Prisma schema 更新**：
```prisma
// 保留 AgentRun（极简），删除其他 Agent 相关表
model AgentRun {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  sessionId    String?  @map("session_id") @db.Uuid
  status       String
  inputText    String   @map("input_text")
  model        String
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  version      Int      @default(1)

  @@index([userId, status])
  @@index([userId, createdAt(sort: Desc)])
  @@map("agent_runs")
}

// 删除:
// - AgentMessage
// - AgentRunStateSnapshot
// - ToolExecution
```

---

### Phase 2: 创建 PostgresCheckpointer 初始化模块

**新文件**: `server/src/modules/agent/langgraph/postgres-checkpointer.ts`

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';

// 创建 Pool（复用现有 DATABASE_URL）
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

// 官方 PostgresSaver（自动创建 checkpoints + checkpoint_blobs + checkpoint_writes 表）
export const checkpointer = new PostgresSaver(pool);

// 初始化表（首次运行调用）
export async function initCheckpointer(): Promise<void> {
  await checkpointer.setup();  // 调用 setup() 创建表
}

export { pool };
```

---

### Phase 3: 修改 graph.ts 启用 checkpointer

**修改**: `server/src/modules/agent/langgraph/graph.ts`

```typescript
import { checkpointer } from './postgres-checkpointer';
import { Command, END, START } from '@langchain/langgraph';

// 编译时绑定 checkpointer
export const agentGraph = workflow.compile({
  checkpointer,
  interruptBefore: ['request_confirmation'],  // 在确认节点中断
  interruptAfter: ['finalize'],              // 在完成节点中断
});

// 修改 requestConfirmationNode 使用 Command
async function requestConfirmationNode(state: AgentState): Promise<Partial<AgentState> | Command> {
  if (!state.pendingToolExecution) {
    return { status: 'completed' };
  }

  return new Command({
    resume: undefined,
    goto: 'execute_confirmed_tool',
    update: {
      status: 'waiting_confirmation',
      requiresConfirmation: false,
      timeline: [
        ...state.timeline,
        { type: 'confirmation', timestamp: new Date().toISOString(), data: state.pendingToolExecution },
      ],
    },
  });
}

// 修改 finalizeNode
async function finalizeNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  return {
    finalText: lastMessage?.content || '',
    status: state.error ? 'failed' : 'completed',
    timeline: [
      ...state.timeline,
      { type: state.error ? 'interrupted' : 'llm_end', timestamp: new Date().toISOString(), data: {} },
    ],
  };
}
```

---

### Phase 3.5: 消息记忆管理（防止上下文溢出）

**问题**：多轮对话会导致 `messages` 数组越来越长，最终超出模型的上下文限制。

**解决方案**：使用 LangChain Core 的 `trimMessages` 工具，在每次 LLM 调用前修剪消息。

**新增文件**: `server/src/modules/agent/langgraph/message-manager.ts`

```typescript
import { trimMessages } from '@langchain/core/messages';
import { ChatModel, getModelTokenCount } from './chatModel';

interface MessageManagerConfig {
  maxTokens: number;        // 最大 token 数（如 128000）
  strategy: 'last' | 'first';  // 保留策略
  endOnType?: string[];     // 结束于指定类型（如 ['human']）
}

/**
 * 消息管理器：自动修剪过长的话题历史
 */
export class MessageManager {
  constructor(private config: MessageManagerConfig) {}

  /**
   * 修剪消息，确保不超过 maxTokens
   * @param messages 对话消息数组
   * @returns 修剪后的消息数组
   */
  async trim(messages: BaseMessage[]): Promise<BaseMessage[]> {
    if (messages.length === 0) return messages;

    const tokenCount = await getModelTokenCount(messages);
    if (tokenCount <= this.config.maxTokens) {
      return messages;  // 不需要修剪
    }

    // 使用 trimMessages 修剪
    return trimMessages(messages, {
      maxTokens: this.config.maxTokens,
      tokenCounter: getModelTokenCount,
      strategy: this.config.strategy,
      endOnType: this.config.endOnType,
    });
  }
}

// 创建默认实例（可配置）
export const messageManager = new MessageManager({
  maxTokens: 128000,           // 模型上下文窗口的 80%
  strategy: 'last',            // 保留最近的对话
  endOnType: ['human', 'user'], // 在用户消息处截断，避免截断助手回复
});
```

**修改 graph.ts 的 callModelNode**:

```typescript
import { messageManager } from './message-manager';

async function callModelNode(state: AgentState): Promise<Partial<AgentState>> {
  const chatModel = createChatModel(state.provider, state.model);

  // 1. 准备消息
  let messages = state.messages.map(m => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });

  // 2. 修剪消息（防止超出上下文限制）
  messages = await messageManager.trim(messages);

  // 3. 调用模型
  const response = await chatModel.invoke(messages);
  // ...
}
```

**不同模型的上下文限制配置**：

| 模型 | 上下文窗口 | 推荐 maxTokens | 配置 |
|------|-----------|----------------|------|
| GPT-4o | 128K | 100K (80%) | `maxTokens: 100000` |
| Claude 3.5 | 200K | 160K (80%) | `maxTokens: 160000` |
| Llama 3.1 | 128K | 100K (80%) | `maxTokens: 100000` |

**可选：摘要策略**（如果需要更精细的记忆管理）：

```typescript
// 备选方案：使用 LLM 生成摘要
async function summarizeMessages(messages: BaseMessage[]): Promise<BaseMessage[]> {
  if (messages.length < 10) return messages;  // 少于 10 条不摘要

  const summarizationPrompt = `将以下对话历史压缩为简短摘要：
${messages.map(m => `${m._getType()}: ${m.content}`).join('\n')}`;

  const summary = await chatModel.invoke([new HumanMessage(summarizationPrompt)]);
  return [
    new SystemMessage('以下是之前的对话摘要：'),
    new AIMessage(summary.content),
    ...messages.slice(-2),  // 保留最近 2 条
  ];
}
```

**Phase 3.5 改动范围**：
- 新增 `message-manager.ts`
- 修改 `graph.ts` 的 `callModelNode`

---

### Phase 4: 重写 Service 层

**修改**: `server/src/modules/agent/service.ts`

```typescript
import { agentGraph, executeAgentGraph, continueAgentGraph } from './langgraph/graph';
import { checkpointer } from './langgraph/postgres-checkpointer';

// 简化后的 executeAgentRunRecordLifecycle
export async function executeAgentRunRecordLifecycle(input, emit) {
  // 1. 创建 AgentRun 元数据
  const run = await createAgentRun({ id: runId, userId, status: 'pending', ... });

  // 2. 调用 graph 执行（checkpointer 自动保存每个节点状态）
  const result = await executeAgentGraph(input, { configurable: { thread_id: run.id } });

  // 3. 更新 AgentRun 状态
  await updateAgentRun(run.id, { status: result.status });

  return buildAgentRunDetail(run.id);
}

// 简化后的 confirmAgentRunTool
export async function confirmAgentRunTool(runId, toolExecutionId, input) {
  // 1. 从 checkpointer 获取状态
  const state = await agentGraph.getState({ configurable: { thread_id: runId } });

  // 2. 恢复执行
  const result = await continueAgentGraph(runId, confirmedToolCall);

  // 3. 更新状态
  await updateAgentRun(runId, { status: result.status });

  return buildAgentRunDetail(runId);
}

// 新增：从 checkpoint 构建展示详情
async function buildAgentRunDetail(runId: string) {
  const state = await agentGraph.getState({ configurable: { thread_id: runId } });
  return {
    id: runId,
    status: state.values.status,
    inputText: state.values.inputText,
    messages: state.values.messages,
    executedToolCalls: state.values.executedToolCalls,
    timeline: state.values.timeline,
  };
}
```

---

### Phase 5: 重写 Repository 层

**修改**: `server/src/modules/agent/repository.ts`

```typescript
// 极简 repository（只操作 AgentRun 表）
export async function createAgentRun(input: CreateAgentRunInput) {
  return prisma.agentRun.create({ data: { id: input.id, userId: input.userId, ... } });
}

export async function updateAgentRun(id: string, input: UpdateAgentRunInput) {
  return prisma.agentRun.update({ where: { id, userId }, data: { status: input.status, version: { increment: 1 } } });
}

export async function findAgentRunById(id: string) {
  return prisma.agentRun.findUnique({ where: { id, userId } });
}

// 删除大量旧函数：
// - appendAgentMessage()
// - findLatestAgentRunSnapshot()
// - createToolExecution()
// - findToolExecutionById()
// - updateToolExecution()
// - deleteAgentRunById() 的级联删除
```

---

### Phase 6: 重写 Schema 层

**修改**: `server/src/modules/agent/schema.ts`

```typescript
// 极简 schema（只验证 AgentRun）
const createAgentRunSchema = z.object({
  inputText: z.string().trim().min(1).max(5000),
  model: z.string().default('default'),
  sessionId: z.string().uuid().optional(),
});

const updateAgentRunSchema = z.object({
  status: z.enum(['pending', 'running', 'waiting_confirmation', 'completed', 'failed', 'cancelled']),
});

// 删除：
// - AppendAgentMessageInput
// - CreateToolExecutionInput
// - ConfirmToolExecutionInput
// - ToolExecution 相关 schema
```

---

### Phase 7: 重写 Routes 层

**修改**: `server/src/modules/agent/routes.ts`

```typescript
// 极简 routes（只处理 AgentRun CRUD）
// GET / — 列表（简化，只返回 AgentRun 元数据）
// POST / — 创建新 run
// GET /:id — 详情（从 checkpoint 恢复）
// DELETE /:id — 删除

// 删除：
// - POST /:id/messages — 追加消息（不需要）
// - POST /:id/confirm — 确认工具
// - POST /:id/reject — 拒绝工具
// - GET /:id/snapshots — 快照列表
```

---

### Phase 8: 重写 DTO 层

**修改**: `server/src/modules/agent/dto.ts`

```typescript
// 极简 DTO（从 checkpoint 恢复完整状态）
export function toAgentRunDto(run: AgentRun) {
  return { id: run.id, status: run.status, inputText: run.inputText, ... };
}

// 新增：从 AgentState 构建详情
export function buildAgentRunDetailDto(state: StateSnapshot) {
  const v = state.values;
  return {
    id: v.runId,
    status: v.status,
    inputText: v.inputText,
    messages: v.messages,
    toolExecutions: v.executedToolCalls,
    timeline: v.timeline,
    finalText: v.finalText,
  };
}
```

---

## 关键修改文件清单

| 文件 | 操作 | 变更 |
|------|------|------|
| `prisma/schema.prisma` | **修改** | 删除 AgentMessage、ToolExecution、AgentRunStateSnapshot |
| `server/src/modules/agent/langgraph/postgres-checkpointer.ts` | **新建** | PostgresSaver 初始化 |
| `server/src/modules/agent/langgraph/graph.ts` | **修改** | 启用 checkpointer，扩展 state |
| `server/src/modules/agent/langgraph/state.ts` | **修改** | 添加 timeline 字段 |
| `server/src/modules/agent/langgraph/message-manager.ts` | **新建** | 消息修剪管理器 |
| `server/src/modules/agent/service.ts` | **重写** | 简化为 checkpoint 驱动 |
| `server/src/modules/agent/repository.ts` | **重写** | 极简，只操作 AgentRun |
| `server/src/modules/agent/schema.ts` | **重写** | 极简 schema |
| `server/src/modules/agent/routes.ts` | **重写** | 极简 CRUD |
| `server/src/modules/agent/dto.ts` | **重写** | 从 checkpoint 构建 DTO |
| `server/src/modules/agent/langgraph/streaming.ts` | **删除** | 不再需要 |
| `server/src/modules/agent/langgraph/persistence.ts` | **删除** | 不再需要 |

---

## 前端适配

由于 API 响应结构变化，前端需要适配：

### AgentDetail 展示
```typescript
// 从 checkpoint 获取完整状态
interface AgentDetailResponse {
  id: string;
  status: RunStatus;
  inputText: string;
  messages: ConversationMessage[];      // 从 checkpoint 恢复
  toolExecutions: ExecutedToolCall[];    // 从 checkpoint 恢复
  timeline: TimelineEvent[];             // 从 checkpoint 恢复
  finalText: string;
}

// 不再需要 separate endpoints:
// - GET /:id/messages
// - GET /:id/snapshots
// - GET /:id/tool-executions
```

### SSE 流式事件
```typescript
// 复用现有 StreamEvent，但在完成时从 checkpoint 恢复完整状态
type StreamEvent =
  | { type: 'status'; runId: string; status: RunStatus }
  | { type: 'text_chunk'; runId: string; text: string }
  | { type: 'tool_call'; runId: string; toolName: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; runId: string; toolName: string; result: unknown; success: boolean }
  | { type: 'confirmation_request'; runId: string; pendingToolExecution: PendingToolExecution }
  | { type: 'error'; runId: string; error: string }
  | { type: 'run_completed'; runId: string; detail: AgentDetailResponse };
```

---

## 验证计划

### 数据库迁移
```bash
npx prisma migrate dev --name refactor_agent_to_checkpoint
# 验证 checkpoints + checkpoint_blobs + checkpoint_writes 表创建成功
# 验证 agent_messages + tool_executions + agent_run_state_snapshots 表已删除
```

### 功能验证
```typescript
// 1. 创建 run → 执行 → 完成
test('完整执行流程', async () => {
  const run = await createAgentRun({ inputText: '你好' });
  // 触发执行...
  const state = await agentGraph.getState({ configurable: { thread_id: run.id } });
  expect(state.values.status).toBe('completed');
});

// 2. 中断 → 确认 → 完成
test('中断恢复流程', async () => {
  // 创建需要确认的 run...
  const state = await agentGraph.getState({ configurable: { thread_id: runId } });
  expect(state.values.status).toBe('waiting_confirmation');
  // 确认后恢复...
});

// 3. 状态历史
test('检查point历史', async () => {
  const history = [];
  for await (const tuple of agentGraph.getStateHistory({ configurable: { thread_id: runId } })) {
    history.push(tuple);
  }
  expect(history.length).toBeGreaterThan(0);
});

// 4. 消息修剪（防止上下文溢出）
test('消息修剪', async () => {
  // 模拟长对话
  const longMessages = Array(50).fill(null).map((_, i) => ({
    role: i % 2 === 0 ? 'human' : 'assistant',
    content: `消息 ${i}: ${'x'.repeat(100)}`,
  }));

  const trimmed = await messageManager.trim(longMessages);
  // 验证修剪后 token 数在限制内
  expect(trimmed.length).toBeLessThan(longMessages.length);
});
```

### E2E 测试
复用 `agent-modules-e2e-cdp.mjs`，验证完整流程。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 数据丢失 | 用户确认不需要迁移，可接受 |
| API 破坏性变更 | 计划允许调整，前端同步修改 |
| checkpoint 性能 | 基准测试监控，必要时优化 |
| PostgresSaver 连接管理 | 复用现有 Pool 配置 |

### 回滚方案
由于是破坏性变更，回滚需要从 git 恢复旧代码 + 运行回滚 migration：

```sql
-- 回滚 migration
DROP TABLE IF EXISTS checkpoints;
DROP TABLE IF EXISTS checkpoint_blobs;
-- 重新创建旧表（从 git 恢复 schema）
```

---

## 时间估算

| Phase | 任务 | 工期 |
|-------|------|------|
| 1 | 安装依赖 + 数据库迁移 | 0.5 天 |
| 2 | PostgresCheckpointer 模块 | 0.5 天 |
| 3 | graph.ts 启用 checkpointer | 1 天 |
| 3.5 | message-manager.ts 消息记忆管理 | 0.5 天 |
| 4 | Service/Repository/Schema 重写 | 1-2 天 |
| 5 | Routes/DTO 重写 | 0.5 天 |
| 6 | 前端适配 + E2E 测试 | 1 天 |
| **总计** | | **5-6 天** |
