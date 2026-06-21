# Architecture Debt Register

本文件记录当前仓库中被允许短期保留、但不应继续扩张的结构历史债务。

## Compat Facades

- `python-backend/app/services/agent/__init__.py`
  - 状态：冻结
  - 原因：历史导入兼容
  - 当前剩余调用方：无（仅保留兼容导出面，等待后续删除）
  - 规则：不新增导出，不新增调用方，只允许迁移后删除
- `python-backend/app/services/knowledge_rag.py`
  - 状态：冻结
  - 原因：历史调用兼容与超大 facade 过渡期
  - 当前剩余调用方：无（仅保留兼容导出面，等待后续删除）
  - 规则：新代码优先走 `knowledge_rag_public` 或具体子模块

## Frontend Allowlist

- `src/core/index.ts`
- `src/core/events/index.ts`
- `src/core/errors/index.ts`
- `src/core/types/index.ts`
- `src/core/validation/index.ts`
- `src/shared/store/index.ts`
- `src/features/agent/runtime/index.ts`
- `src/features/agent/types/index.ts`
- `src/features/knowledge/sync/index.ts`
- `src/features/settings/api/index.ts`
  - 状态：允许保留
  - 原因：基础设施或稳定子域聚合出口
  - 规则：不新增新的同类 wildcard barrel；若能改成显式导出或 `public.ts`，优先收口

## Cross-Feature Public Entrypoints

- `src/features/settings/public.ts`
  - 状态：新增正式公共子入口
  - 原因：将 Agent runtime 对 Provider 配置能力的依赖从 `settings/api/providers.ts` 收口为受控公开面
  - 规则：跨 feature 优先走 `public.ts`；`api/*` 仅在确有必要时保留
- `src/features/knowledge/public.ts`
  - 状态：扩展为正式公共子入口
  - 原因：将知识笔记与 RAG 的跨 feature 使用点从 `knowledge/api/*` 收口为受控公开面
  - 规则：跨 feature 优先走 `public.ts`；`settings/api` 仍是当前少数 allowlist 例外

## Bundle Debt

- `vendor`
- `main`
- `chart-vendor`
  - 状态：tracked debt
  - 原因：当前仍高于 webpack 推荐告警阈值
  - 规则：修改相关入口、重依赖或拆包策略时优先顺手削减
