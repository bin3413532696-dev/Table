# CLAUDE.md

This file is a Claude compatibility mirror for this repository. The authoritative project conventions live in the root `AGENTS.md` and `.Codex/`; if this file diverges from those sources, follow the root documents.

## Project Overview

Table 是一个面向个人使用的 AI 工作台：React + TypeScript 前端 + FastAPI 后端 + 独立 OCR 微服务，使用 PostgreSQL（含 pgvector 扩展）作为唯一持久层。核心场景是从大体量资料中持续学习新知识，支持 PDF、Markdown、TXT、扫描件等资料的解析、OCR 降级、切片、混合检索、重排和 Agent 调用。

## Common Commands

```bash
npm run dev
npm run backend:dev
npm run ocr:dev
npm run test:frontend-api
npm run typecheck
uv sync --default-index https://pypi.org/simple --package table-python-backend
uv run --default-index https://pypi.org/simple --package table-python-backend pytest python-backend/tests -q
```

## Current Architecture Conventions

- 前端正式分层是 `src/app/`、`src/features/<domain>/`、`src/shared/`、`src/core/`。
- 跨 feature 默认通过各自的 `public.ts` 入口依赖，不直接横穿内部实现。
- 后端正式分层是 `api/routes/`、`services/`、`repositories/`、`schemas/`、`db/`。
- Agent 运行时公共入口使用 `app.services.agent.public`。
- Knowledge RAG 运行时公共入口使用 `app.services.knowledge_rag_public`；`app.services.knowledge_rag` 仅保留兼容职责。
- 错误响应统一为 `{\"error\": \"<CODE>\", \"message\": \"...\"}`。

## Project Conventions

- 当前项目级 AI 协作主目录是 `.Codex/`。
- 新的 plan 默认放 `.Codex/plans/`，新的 skill 默认放 `.Codex/skills/`。
- `.claude/`、`.agents/` 视为历史或并存工具目录，只保留必要兼容说明，不再作为新的项目主约定入口。
- 项目偏好、仓库级规则和结构治理以根 `AGENTS.md` 与 `.Codex/` 为单一事实来源，不要把 `.claude/` 继续扩展成第二套独立规范。
