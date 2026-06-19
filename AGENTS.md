# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Table 是一个面向个人使用的 AI 工作台：React + TypeScript 前端 + FastAPI 后端 + 独立 OCR 微服务，使用 PostgreSQL（含 pgvector 扩展）作为唯一持久层。项目当前的核心定位不是通用办公，而是服务“从大体量资料中持续学习新知识”的场景：用户可上传 PDF、Markdown、TXT、扫描件等文件，系统完成解析、切片、混合检索、重排与 OCR 降级，并在此基础上通过 LangGraph Agent 在单轮对话中跨知识库、任务、财务等模块操作。功能模块：任务、财务、知识笔记、RAG 知识库、AI Agent、Provider 管理。

历史背景：原为 TypeScript 全栈（Express + Prisma + React），后迁移至 Python 后端。**Prisma 现仅用于迁移管理，运行时 ORM 用 SQLAlchemy 2.0（async）**。

## Common Commands

### 运行服务（开发）
```bash
npm run dev              # 前端 webpack-dev-server，端口 3266
npm run backend:dev      # uv run uvicorn app.main:app，端口 8787，--reload
npm run ocr:dev          # OCR 服务（PaddleOCR），端口 8001，--reload
```
前端通过 webpack devServer proxy 把 `/api/*` 转发到 `http://127.0.0.1:8787`（见 `webpack.config.js:57`）。前端独立访问 `http://127.0.0.1:3266`。

### 数据库
```bash
npx prisma migrate deploy     # 应用迁移
npx prisma generate           # 重新生成 Prisma client（仅迁移工具用）
npx prisma migrate dev --name <name>   # 创建新迁移（开发期）
```
迁移目录 `prisma/migrations/`（按时间戳前缀排序）。

### 测试
```bash
npm run backend:test          # 全部后端 pytest
npm run typecheck             # 前端 tsc --noEmit
npm run test:frontend-api     # 前端 API 层 node:test

# 单文件后端测试（直接调 uv）：
uv run --package table-python-backend pytest python-backend/tests/test_knowledge_rag_api.py -q

# 单个用例：
uv run --package table-python-backend pytest python-backend/tests/test_knowledge_rag_api.py::test_name -q
```
后端测试 `pytest-asyncio` 配置为 `asyncio_mode = "auto"`，async 测试无需 `@pytest.mark.asyncio`。

烟雾测试与 e2e 测试见 `package.json` scripts（`*:smoke` / `*:e2e`），需先启动后端。

### 依赖
```bash
uv sync --package table-python-backend   # 后端依赖（uv workspace）
uv sync --package table-ocr-service      # OCR 服务依赖
npm install                              # 前端依赖
```

## High-Level Architecture

### uv Workspace（多包 Python 项目）
根 `pyproject.toml` 声明 `tool.uv.workspace.members = ["python-backend", "ocr-service"]`。所有 Python 命令通过 `uv run --package <name>` 执行；npm scripts 已封装主要入口。

### 后端请求生命周期（`python-backend/app/main.py`）

每个请求穿过两层中间件后才进入路由：

1. **CSRF 校验**：非 GET/HEAD/OPTIONS 且非 `/api/health` 必须带 CSRF token；GET 响应自动种 cookie。
2. **用户上下文解析**（`resolve_request_user_context`）→ `set_user_context`（contextvar）。优先级：
   - signed session cookie `table_dev_session_user_id`
   - `x-user-id` header（仅当 `TRUST_USER_ID_HEADER=true`）
   - fallback 到 `default_user_id`（仅当 `ALLOW_DEFAULT_USER_FALLBACK=true`，否则 401）

   依赖注入 `AuthenticatedUser`（`app/dependencies.py`）会首次访问时自动创建 default user 并 bootstrap provider。

3. **路由** → service → repository → SQLAlchemy async session。

### 后端分层约定
```
api/routes/   → 路由层：参数校验、异常→HTTPException 转换
services/     → 业务编排（事务、外部调用、跨表逻辑）
repositories/ → 数据访问（原生 SQL + SQLAlchemy，含 pgvector 查询）
db/models.py  → ORM 模型（真实表结构权威来源）
schemas/      → Pydantic 请求/响应模型
core/         → config（pydantic-settings + lru_cache 单例）、csrf、session、加密
```

### 错误响应统一格式
全局 handler（`main.py:79-94`）保证所有错误 JSON 都是 `{"error": "<CODE>", "message": "..."}`：
- `HTTPException`：detail 为 dict 时**原样透传**（用于自定义业务错误码）
- `AuthError` → 401/403，`VersionConflictError` → 409，`RequestValidationError` → 422 加 `details`
- 未捕获 `Exception` → 500 `INFRASTRUCTURE_ERROR`（记录 stack 但不泄露）

**新增业务错误时**：仿 `IndexJobActiveError` / `DocumentQualityError`（`services/knowledge_rag.py`）—构造 `detail` dict，service 抛出，路由 catch 后转 `HTTPException(status_code=4xx, detail=exc.detail)`。

### RAG Pipeline（自研，不用 LangChain/LlamaIndex）

入口 `app/services/knowledge_rag.py`，分阶段：

该链路面向“大文件学习”场景，不应在文档或实现上被描述成仅支持 PDF；PDF 只是其中最重要的一类资料来源。

**上传链路（同步）**：`upload_document_service` 创建 `pending` 文档 + job → 写文件 → `asyncio.create_task(_run_indexing_pipeline_task(...))` fire-and-forget → 立即返回。请求不阻塞 pipeline；前端轮询 `/api/knowledge-rag/jobs/{id}` 看进度。

**Pipeline 任务（`_run_indexing_pipeline_task`，独立 `SessionLocal`）**：
1. **解析**：`_extract_upload_content`
   - PDF：pypdf 探针判扫描件 → 扫描件走 OCR（PaddleOCR）fallback；文本 PDF 走 MarkItDown（`knowledge_rag_pdf.py`）转 Markdown；MarkItDown 失败再退 OCR
   - txt/md：`_decode_text_content`（含 UTF-16/GB18030 嗅探）
2. **质量预检**（仅 PDF，在上传同步阶段）：`_preflight_pdf_quality` 用 pypdf 抽前几页，有效字符率 < 80% 直接拒入库（`DocumentQualityError`）；扫描件（pypdf 抽空）跳过预检
3. **图片提取**（MarkItDown 路径，并行于解析）：`knowledge_rag_pdf.py` 用 PyMuPDF 提栅格图（`page.get_images()` + bbox）+ 矢量图（`page.get_drawings()` 按 eps 邻域 DBSCAN 聚类，min_size/min_paths 过滤装饰线，按 bbox 渲染 PNG）。图片按 (page, idx) 重新编号，追加 `[IMAGE:page=N;idx=M]` 占位符到 markdown 流，图片文件存到 `<upload_dir>/<doc_id>_images/`
4. **图片描述（VLM）**：`_describe_images_and_replace_placeholders` 三阶段（避免 AsyncSession 并发使用）—串行查 `knowledge_image_description_cache`（按 content_hash 去重）→ gather 并发跑 VLM（`knowledge_rag_vision.py` 的 OpenAI 兼容 `/chat/completions` + `image_url` data URL，semaphore 限流）→ 串行写缓存 + 替换占位符。硬上限 `RAG_VISION_LLM_MAX_IMAGES_PER_DOC` 防止 Provider 配额打爆
5. **切分**：`knowledge_rag_indexing.py` — 父子双层（small chunk 入向量库 + parent chunk 提供上下文），按 file_type 差异化 chunk_size
6. **嵌入**：`knowledge_rag_embeddings.py` — OpenAI 兼容 `/v1/embeddings`，small chunk 才嵌入；带 `knowledge_embedding_cache` 表（按 content_hash 去重）
7. **检索**：`search_service` — hybrid（keyword `ILIKE` + semantic pgvector `<=>`）→ RRF 融合 → 可选 MMR → 可选 cross-encoder 重排

**VLM/嵌入/重排 Runtime 模式**：所有外部 AI 服务（embedding / reranker / query_preprocessor / vision_llm / agent）都遵循同一模式 — `XxxRuntimeConfig` dataclass（frozen）+ `resolve_xxx_runtime_config(session, user_id, settings)` 函数，优先读 settings 直配，否则 fallback 到 active Provider（key 经 `provider_crypto` 加密存库）。新增 AI 服务照搬这个模式。

向量存储：PostgreSQL `vector(1024)` 列 + HNSW + `vector_cosine_ops` 索引（迁移 `20260521_enable_pgvector_rag`）。

**进程重启容错**：`main.py` 的 `lifespan` 钩子在启动时调 `fail_orphan_jobs_on_startup` 把上一次进程留下的 pending/running job 标记为 failed（防止 fire-and-forget 模式下文档永久卡在 pending）。

### Agent（LangGraph）
`app/services/agent/` 用 LangGraph 编排多 Provider 流式对话。工具位于 `agent/tools/`（tasks/finance/knowledge/rag），通过 `registry.py` 注册。Provider API key 经 `provider_crypto` 加密存库。

### OCR 微服务（独立进程）
`ocr-service/main.py`：FastAPI + PaddleOCR（PPStructure）+ PyMuPDF。PDF 转 PNG（200 DPI）后逐页布局分析，表格转 Markdown。后端通过 `OCRServiceClient` HTTP 调用 `/ocr/process`。**仅作为扫描件 fallback**（MarkItDown 对扫描件返回空时触发）——文本 PDF 不经过此服务。**可独立部署/缺失**，后端有完整 pypdf 回退路径。

## Configuration

`Settings` 类（`app/core/config.py`）：`pydantic-settings` + `lru_cache` 单例。env 文件读取顺序：`REPO_ROOT/.env` → `SERVICE_ROOT/python-backend/.env`（后者覆盖前者）。新增配置项统一风格：

```python
field_name_snake: Type = Field(default=..., validation_alias="ENV_VAR_UPPER")
```

## Code Style

- **Python**：ruff line-length=120，target py311。Lint 规则 `E, F, I, W, UP`。注释默认不写，仅在 WHY 非显而易见时加一行。
- **TypeScript**：`tsc --noEmit` 必须零错误（CI 检查项）。
- **错误处理**：service 层抛语义化异常，路由层 catch 转 HTTPException；不要在 service 里直接 `raise HTTPException`。

## Testing Patterns

- 后端测试位于 `python-backend/tests/`，命名 `test_<module>_<aspect>.py`，每模块独立文件。
- 测试通过 `app.dependencies` 的 override 或直接调 service 函数；避免启动完整 HTTP server，除非测 router 本身。
- 数据库测试用真实 PostgreSQL（asyncpg），不 mock；pgvector 与 pg_trgm 依赖必须存在。
- 前端 API 测试（`tests/frontend-api/`）走 `node:test`，编译到 `dist-frontend-tests/` 后运行。

## Project Conventions（项目自包含约定）

用户要求所有项目产出内聚在仓库目录内，便于备份/迁移/清理：

- **Plan 文件**：进入 plan mode 时，plan 文件路径必须是项目级 `.Codex/plans/<name>.md`，**不要**使用全局 `~/.Codex/plans/`。系统提示给出的全局路径需要主动改写。
- **Skill 文件**：项目级 skill 放 `.Codex/skills/<name>/SKILL.md`。历史上已有 `.claude/skills/` 可参考；若迁移到 Codex，沿用相同目录结构即可。
- **Memory / 偏好记录**：项目相关的用户偏好、约定写在仓库根目录的 `AGENTS.md` 里，不要写到全局 `~/.Codex/projects/<slug>/memory/`。Codex 框架的 memory 系统路径是固定的全局位置，但项目偏好作为约定文档放在 `AGENTS.md` 才能保证项目自包含且被自动加载。
