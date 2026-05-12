---
title: Agent LangGraph 迁移方案
created: 2026-05-11
---

# Context

将项目中自建的 ReAct Agent 系统全面替换为 LangGraph.js。当前实现位于 `executor.ts`（~1150行），采用文本解析工具调用、自建 Provider 适配、手动状态快照等方式。迁移目标是利用 LangGraph 的图结构、interrupt 机制和 Checkpointer，获得更规范的状态管理、原生 function_calling 支持、以及更好的人机协作能力。

用户选择：
- **渐进式迁移**：保留旧 executor 作为环境变量切换的 fallback
- **全量 function_calling**：所有 Provider 迁移到原生 tool calling
- **新增数据库字段**：为 LangGraph checkpoint 添加专用字段

---

# Architecture Design

## LangGraph 图结构

```
                    ┌──────────────┐
                    │   llmNode    │
                    │(调用 LLM)    │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              │ hasToolCalls?           │
              ├────────────┼────────────┤
              │ no         │ yes        │
              ▼            ▼            │
           ┌─────┐    ┌──────────┐      │
           │ END │    │queryTools│      │
           └     │    │(并行执行) │      │
                    └────┬─────┘        │
                         │              │
              ┌──────────┴──────────┐   │
              │ hasWriteTool?       │   │
              ├──────────┬──────────┤   │
              │ no       │ yes      │   │
              ▼          ▼          │   │
           ┌─────┐  ┌──────────┐    │   │
           │llm  │  │writeTools│◄───┘   │
           │Node │  │(interrupt)│        │
           └─────┘  └────┬─────┘        │
                    │    │              │
                    │    │ resume       │
                    │    ▼              │
                    │ ┌──────────┐      │
                    │ │execute   │      │
                    │ │writeTool │      │
                    │ └────┬─────┘      │
                    │      │            │
                    │      ▼            │
                    │  ┌─────┐          │
                    └──►llm  │──────────┘
                       │Node │
                       └─────┘
```

**关键设计**：
- `interrupt_before: ["writeToolsNode"]` 实现确认门控
- 查询类工具并行执行（复用现有缓存逻辑）
- 写操作工具在确认后 resume 继续执行

## 状态定义

```typescript
interface AgentState {
  messages: BaseMessage[];              // 对话历史
  inputText: string;                    // 用户输入
  model: string;                        // 模型名称
  userId: string;                       // 用户 ID
  provider: AgentProviderInput;         // Provider 配置
  executedToolCalls: ToolExecution[];   // 已执行工具记录
  pendingToolCall?: ToolCall;           // 待确认工具
  iterationCount: number;               // 循环计数（限5轮）
  finalResponse?: string;               // 最终回复
}
```

## 数据库变更

新增 LangGraph checkpoint 专用字段：

```prisma
model AgentRunStateSnapshot {
  // 现有字段
  id           String   @id ...
  userId       String   ...
  runId        String   ...
  snapshotJson Json     @map("snapshot_json")
  createdAt    DateTime ...

  // 新增字段
  langgraphThreadId    String?  @map("langgraph_thread_id")
  langgraphThreadTs    String?  @map("langgraph_thread_ts")
  langgraphCheckpointNs String? @map("langgraph_checkpoint_ns")
  checkpointType       String?  @default("legacy") @map("checkpoint_type")
}
```

---

# Implementation Plan

## Phase 0: 基础设施准备（3-5 天）

### 0.1 安装依赖

```json
{
  "dependencies": {
    "@langchain/langgraph": "^0.2.x",
    "@langchain/core": "^0.3.x",
    "@langchain/openai": "^0.3.x",
    "@langchain/anthropic": "^0.3.x",
    "@langchain/google-generativeai": "^0.1.x",
    "zod": "^3.x"  // 已有，用于 tool schema
  }
}
```

### 0.2 新建目录结构

```
server/src/modules/agent/langgraph/
├── graph.ts            # StateGraph 定义
├── state.ts            # AgentState 类型
├── tools.ts            # 9 个工具定义（Zod schema）
├── checkpointer.ts     # PrismaCheckpointer 实现
├── provider-adapter.ts # 多 Provider 适配工厂
├── stream-adapter.ts   # LangGraph stream → SSE
├── executor.ts         # LangGraph 执行入口
└── index.ts            # 模块导出
```

### 0.3 数据库迁移

新增 `langgraph_*` 字段到 `AgentRunStateSnapshot`。

---

## Phase 1: 核心组件实现（5-7 天）

### 1.1 工具定义 (`tools.ts`)

将 9 个现有工具转换为 LangGraph tool 格式：

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const queryTasksTool = tool({
  name: "query_tasks",
  description: "查询任务列表",
  schema: z.object({
    completed: z.boolean().optional().describe("是否已完成"),
    priority: z.enum(["low", "medium", "high"]).optional(),
    limit: z.number().int().positive().optional(),
  }),
  func: async (input) => {
    return await listTasks(input);
  },
});

// 工具分类标记
export const tools = {
  query: [queryTasksTool, getTaskStatsTool, queryFinanceTool, getFinanceStatsTool, searchKnowledgeTool],
  write: [createTaskTool, addFinanceRecordTool, updateTaskTool, deleteTaskTool],
};
```

### 1.2 Provider 适配器 (`provider-adapter.ts`)

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-generativeai";

export function createChatModel(provider: ApiProvider): BaseChatModel {
  // 解密 API Key
  const apiKey = decryptProviderSecret(provider.apiKeyEncrypted);

  switch (provider.apiFormat) {
    case "openai":
      return new ChatOpenAI({
        modelName: provider.model,
        configuration: { baseURL: provider.baseUrl },
        apiKey,
      });
    case "anthropic":
      return new ChatAnthropic({
        modelName: provider.model,
        anthropicApiKey: apiKey,
      });
    case "gemini":
      return new ChatGoogleGenerativeAI({
        model: provider.model,
        apiKey,
      });
    case "custom":
      // Custom Provider 必须支持 OpenAI-compatible function calling
      return new ChatOpenAI({
        modelName: provider.model,
        configuration: { baseURL: provider.baseUrl },
        apiKey,
      });
  }
}
```

### 1.3 图定义 (`graph.ts`)

```typescript
import { StateGraph, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const graph = new StateGraph<AgentState>({
  channels: {
    messages: { value: (x, y) => x.concat(y), default: () => [] },
    inputText: { value: null },
    model: { value: null },
    userId: { value: null },
    provider: { value: null },
    executedToolCalls: { value: (x, y) => x.concat(y), default: () => [] },
    pendingToolCall: { value: null },
    iterationCount: { value: null, default: () => 0 },
    finalResponse: { value: null },
  },
});

// 节点实现
graph.addNode("llmNode", llmNodeHandler);
graph.addNode("queryToolsNode", queryToolsNodeHandler);
graph.addNode("writeToolsNode", writeToolsNodeHandler);

// 边与条件路由
graph.addEdge("queryToolsNode", "llmNode");
graph.addConditionalEdges("llmNode", routeAfterLLM);
graph.addConditionalEdges("queryToolsNode", routeAfterQueryTools);

// 关键：写操作前 interrupt
graph.interruptBefore(["writeToolsNode"]);

export const agentApp = graph.compile({
  checkpointer: new PrismaCheckpointer(),
});
```

---

## Phase 2: 持久化与恢复（3-5 天）

### 2.1 PrismaCheckpointer 实现

```typescript
export class PrismaCheckpointer extends BaseCheckpointSaver {
  async get(config: RunnableConfig): Promise<Checkpoint | undefined> {
    const snapshot = await prisma.agentRunStateSnapshot.findFirst({
      where: {
        runId: config.configurable?.thread_id,
        checkpointType: "langgraph",
      },
      orderBy: { createdAt: "desc" },
    });
    return snapshot ? this.deserialize(snapshot.snapshotJson) : undefined;
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint): Promise<RunnableConfig> {
    await prisma.agentRunStateSnapshot.create({
      data: {
        userId: this.userId,
        runId: config.configurable?.thread_id,
        snapshotJson: this.serialize(checkpoint),
        langgraphThreadId: config.configurable?.thread_id,
        langgraphThreadTs: checkpoint.ts,
        checkpointType: "langgraph",
      },
    });
    return config;
  }
}
```

### 2.2 确认恢复流程

```typescript
async function confirmToolExecution(runId: string, toolCallId: string) {
  const config = { configurable: { thread_id: runId } };

  // 1. 获取当前状态
  const state = await agentApp.getState(config);

  // 2. 更新状态（标记已确认）
  await agentApp.updateState(config, {
    pendingToolCall: null,
  });

  // 3. Resume 继续执行
  const stream = agentApp.stream(null, config);

  // 4. 转换为 SSE 事件推送
  return langgraphToSseAdapter(stream, runId);
}
```

---

## Phase 3: SSE 流式适配（2-3 天）

### 3.1 事件转换器 (`stream-adapter.ts`)

将 LangGraph stream events 映射到现有 SSE 格式：

| LangGraph Event | SSE Event |
|-----------------|-----------|
| `on_chain_start` | `run_created` |
| `on_llm_stream` (chunk) | `text_chunk` |
| `on_tool_start` | `tool_call` |
| `on_tool_end` | `tool_result` |
| `on_chain_end` | `run_completed` |
| `interrupt` | `run_waiting_confirmation` |

### 3.2 前端兼容性

前端 `agentApi.ts` 无需修改，只要 SSE 事件格式保持一致。

---

## Phase 4: 集成与切换（2-3 天）

### 4.1 service.ts 适配

```typescript
const USE_LANGGRAPH = process.env.AGENT_ENGINE === "langgraph";

async function executeAgentRun(input: CreateAgentRunInput, emit: StreamEventEmitter) {
  if (USE_LANGGRAPH) {
    return executeWithLangGraph(input, emit);
  }
  return executeWithLegacyExecutor(input, emit);  // 保留旧 executor
}
```

### 4.2 环境变量配置

```env
# .env
AGENT_ENGINE=langgraph  # 或 legacy
```

---

# Critical Files

| 文件 | 作用 |
|------|------|
| `server/src/modules/agent/executor.ts` | 现有核心执行器，逻辑迁移来源 |
| `server/src/modules/agent/service.ts` | 业务编排层，需适配 LangGraph 入口 |
| `server/src/modules/agent/repository.ts` | 数据访问层，Checkpointer 复用模式 |
| `server/src/modules/providers/service.ts` | Provider 管理，API Key 解密复用 |
| `prisma/schema.prisma` | 数据模型，需新增字段 |

---

# Verification

## 单元测试

- 查询类工具并行执行正确
- 写操作触发 interrupt
- 确认后 resume 正常恢复
- Checkpointer 读写一致

## E2E 测试

复用 `scripts/e2e/agent-e2e-cdp.mjs`：
- SSE 流式推送正常
- 确认门控 UI 流畅
- 多 Provider 切换无异常

## 手动验证

```bash
# 设置环境变量
AGENT_ENGINE=langgraph npm run server:dev

# 测试对话
curl -X POST http://localhost:8787/api/agent/runs/stream \
  -H "Content-Type: application/json" \
  -d '{"inputText": "查询所有任务"}'

# 测试写操作确认
curl -X POST http://localhost:8787/api/agent/runs/stream \
  -d '{"inputText": "创建任务：测试任务"}'
# 应返回 waiting_confirmation

# 确认后继续
curl -X POST http://localhost:8787/api/agent/runs/{runId}/tools/{toolId}/confirm
```

---

# Risks & Mitigation

| 风险 | 缓解措施 |
|------|----------|
| LangGraph.js API 变更 | 锁定版本，关注 changelog |
| Custom Provider 不支持 function_calling | 用户已确认全部迁移，需验证 Custom Provider |
| SSE 格式不兼容 | 严格映射事件格式，增量测试 |
| 状态恢复不一致 | 快照对比验证，单元测试覆盖 |

---

# Rollback

环境变量切换回 `AGENT_ENGINE=legacy` 即可回退到原有 executor。