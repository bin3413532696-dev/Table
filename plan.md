---
title: Agent LangGraph 迁移方案
created: 2026-05-11
status: completed
completed_date: 2026-05-18
finalized: true
---

# Context

将项目中自建的 ReAct Agent 系统全面替换为 LangGraph.js。原有 `executor.ts`（~1150行）采用文本解析工具调用、自建 Provider 适配、手动状态快照等方式。

**迁移结果**：
- ✅ LangGraph 核心引擎已成为唯一实现
- ✅ Legacy 执行器已完全移除
- ✅ 用户确认流程稳定运行
- ✅ SSE 流式响应兼容现有前端

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

## 实际完成情况

### Phase 1: 基础设施（已完成）
- ✅ 安装依赖：`@langchain/langgraph`、`@langchain/core`、`@langchain/anthropic`、`@langchain/openai`、`@langchain/google-genai`
- ✅ 创建目录：`server/src/modules/agent/langgraph/`
- ✅ 状态定义：`state.ts`（AgentStateAnnotation）
- ✅ 提示模板：`prompts.ts`

### Phase 2: 工具标准化（已完成）
- ✅ 9 个工具转换为 LangChain Tool 接口（`tools.ts`）
- ✅ 工具解析复用（`parser.ts`）
- ✅ `requiresConfirmation` 元数据保留

### Phase 3: ChatModel 适配（已完成）
- ✅ ChatModel 适配层（`chatModel.ts`）
- ✅ 支持 Anthropic/OpenAI/Gemini/Custom 四种格式

### Phase 4: Graph 构建（已完成）
- ✅ StateGraph 定义（`graph.ts`）
- ✅ 节点函数：init/build_messages/call_model/parse_tools/check_confirmation/execute_tools/request_confirmation/finalize
- ✅ 条件路由：afterParseRouter/afterCheckConfirmationRouter/afterExecuteRouter/afterConfirmationRequestRouter

### Phase 5: SSE 流式集成（已完成）
- ✅ 流式执行（`streaming.ts`）
- ✅ 事件转换兼容现有前端格式

### Phase 6: 持久化（已完成）
- ✅ 状态快照持久化（`persistence.ts`）
- ✅ 与现有 `AgentRunStateSnapshot` 表兼容

### Phase 7: Service 层迁移（已完成）
- ✅ `service.ts` 添加 `USE_LANGGRAPH` 环境变量切换
- ✅ 用户确认流程修复（`confirmAgentRunTool` 支持 LangGraph）

### Phase 8: 测试验证（已完成）
- ✅ TypeScript 类型检查通过
- ✅ 手动测试：查询任务、创建任务、删除任务均正常
- ✅ 用户确认流程验证通过

---

# Critical Files

| 文件 | 作用 |
|------|------|
| `server/src/modules/agent/langgraph/*.ts` | LangGraph 核心模块（唯一实现） |
| `server/src/modules/agent/service.ts` | 业务编排层（直接调用 LangGraph） |
| `server/src/modules/agent/repository.ts` | 数据访问层 |
| `server/src/modules/providers/service.ts` | Provider 管理 |

---

# Verification（已完成）

## 类型检查

```bash
npm run server:typecheck  # 通过
npm run typecheck         # 通过
```

## 功能验证

| 测试场景 | 输入 | 结果 |
|---------|------|------|
| 查询任务 | `查询我的任务列表` | ✅ 直接返回结果 |
| 创建任务 | `创建一个任务：测试` | ✅ 弹出确认框 → 确认后创建成功 |
| 删除任务 | `删除任务 xxx` | ✅ 弹出确认框 → 确认后删除成功 |
| 查询财务 | `查询财务记录` | ✅ 直接返回结果 |

---

# Architecture Summary

```
server/src/modules/agent/
├── langgraph/
│   ├── state.ts       # AgentStateAnnotation 状态定义
│   ├── graph.ts       # StateGraph 图结构（节点 + 条件路由）
│   ├── tools.ts       # LangChain Tool（9个）
│   ├── parser.ts      # 工具调用解析
│   ├── chatModel.ts   # ChatModel 适配（Anthropic/OpenAI/Gemini/Custom）
│   ├── streaming.ts   # SSE 流式执行
│   ├── persistence.ts # 状态快照持久化
│   ├── prompts.ts     # 系统提示模板
│   └── index.ts       # 模块导出
├── service.ts         # 业务服务层（直接调用 LangGraph）
├── routes.ts          # REST + SSE 端点
├── repository.ts      # 数据访问层
├── schema.ts          # Zod 验证
└── dto.ts             # DTO 转换
```