# Agent Checkpointer 迁移说明

本文档记录 Agent 运行时迁移到 LangGraph，并接入 PostgreSQL checkpoint 持久化后的完成状态。

## 目标

原始自定义 Agent 运行时依赖手写执行逻辑和自定义持久化方式。迁移的目标是把运行时状态管理收敛到 LangGraph，并使用官方 PostgreSQL checkpointer 作为可恢复执行状态的唯一来源。

## 最终结果

迁移已经完成。

当前状态：

- LangGraph 是唯一在用的 Agent 引擎
- PostgreSQL checkpointer 是运行时持久化层
- `AgentRun` 只存储轻量级元数据
- 确认与恢复依赖 LangGraph 工作流状态完成

## 涉及文件

当前运行时相关文件：

- `server/src/modules/agent/langgraph/state.ts`
- `server/src/modules/agent/langgraph/graph.ts`
- `server/src/modules/agent/langgraph/tools.ts`
- `server/src/modules/agent/langgraph/parser.ts`
- `server/src/modules/agent/langgraph/chatModel.ts`
- `server/src/modules/agent/langgraph/message-manager.ts`
- `server/src/modules/agent/langgraph/postgres-checkpointer.ts`
- `server/src/modules/agent/service.ts`

## 持久化模型

## 业务元数据

`agent_runs` 存储：

- run id
- user id
- 可选 session id
- status
- input text
- model
- 时间戳
- version

它不保存完整消息历史，也不保存图内部状态。

## Checkpoint 状态

Checkpoint 持久化由 LangGraph PostgreSQL 相关表负责：

- `checkpoints`
- `checkpoint_blobs`
- `checkpoint_writes`

这些表会在以下场景中保存图状态：

- 正常执行完成
- 因确认而暂停
- 用户确认或拒绝后的显式恢复

## 运行流程

1. 创建 `AgentRun` 元数据记录
2. 使用 `thread_id = run.id` 调用 LangGraph
3. LangGraph 通过 checkpointer 持久化中间状态
4. 如果写操作工具需要确认，工作流会暂停
5. 后续确认或拒绝会恢复同一个 thread
6. 最终状态会回写到 `agent_runs`

## 为什么采用这个设计

这个设计减少了重复的状态管理：

- 不再为每个中间步骤维护自定义快照表
- 不再需要手写 Agent 进度回放模型
- 同一套运行时模型同时支撑同步与流式执行

同时它还改善了：

- 可恢复性
- 运维理解成本
- run 历史与运行时状态之间的一致性

## 仍然存在的权衡

- 应用层的 `AgentRun` 仍然保留，因为产品侧仍需要业务元数据与历史列表
- 工具调用仍通过文本解析模型输出完成，因此虽然 checkpoint 持久化已经现代化，但工具调用语法还不是完全模型原生
- 随着运行时继续演进，这份迁移文档需要持续与真实 schema 和路由行为保持一致

## 验证基线

当前仓库基线可以确认：

- 后端类型检查通过
- 后端构建通过
- Agent 的创建、流式执行、确认与拒绝链路都已打通
- run 详情可以从 checkpoint 状态重建
- 历史列表依赖 `agent_runs` 与 checkpoint 派生详情共同组成
