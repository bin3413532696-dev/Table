# Python Backend

This service is the production backend for `Table`, a personal RAG + Agent workspace focused on learning from large files over repeated conversations.

## Commands

Run from the repository root:

```bash
uv sync --package table-python-backend
uv run --package table-python-backend uvicorn app.main:app --host 127.0.0.1 --port 8788
uv run --package table-python-backend pytest
RUN_PYTHON_INTEGRATION_TESTS=1 uv run --package table-python-backend pytest python-backend/tests/test_knowledge_rag_integration.py -q
```

## Current scope

- shared config and request middleware
- signed session cookie compatibility and auth routes
- health endpoint
- `tasks`, `finance`, and `knowledge` module contract-compatible migration slices
- `knowledge-rag` slice: upload/save large files, parse PDF / Markdown / TXT and scanned files, parent-child chunk indexing, semantic/hybrid search, query preprocessing, MMR reranking, cross-encoder reranking, embedding backfill, corpus grouping, delete/reindex flow, stats, OCR health wiring
- `maintenance` routes for business snapshot export/import and scoped workspace reset
- provider CRUD routes compatible with the existing `/api/providers` frontend contract
- `agent` routes compatible with `/api/agent/health`, `/api/agent/persona`, session CRUD, run list/detail/create/update/delete, fresh-run execution, streaming execution for `/api/agent/runs/stream`, and layered memory persistence

## Product focus

The backend is optimized for a personal “learn from large materials” workflow:

1. ingest long-form materials instead of only short notes
2. keep retrieval stable across repeated questions on the same source
3. recover scanned files through OCR fallback when text extraction is weak
4. let the agent operate across RAG, tasks, and finance inside one conversation
5. persist short-term and long-term memory conservatively so sessions remain usable over time

The service reads the existing root `.env` and reuses:

- `DATABASE_URL`
- `ALLOW_DEFAULT_USER_FALLBACK`
- `DEFAULT_USER_ID`
- `TRUST_USER_ID_HEADER`
- `PROVIDER_SECRET_KEY`
- `SERVER_HOST` / `PYTHON_SERVER_HOST`
- `SERVER_PORT` / `PYTHON_SERVER_PORT`

## Auth and session

The Python backend now understands the same signed dev session cookie used by the TypeScript server:

- cookie name: `table_dev_session_user_id`
- format: `{userId}.{expiresAt}.{base64(hmac_sha256)}`
- signing secret: `PROVIDER_SECRET_KEY`

Request user resolution now matches the current TypeScript priority:

1. verified signed session cookie
2. `x-user-id` when `TRUST_USER_ID_HEADER=true`
3. `DEFAULT_USER_ID`

The Python backend also now serves the existing auth routes expected by `src/lib/auth.ts`:

1. `GET /api/auth/me`
2. `GET /api/auth/users`
3. `POST /api/auth/users`
4. `PATCH /api/auth/me`
5. `POST /api/auth/session`
6. `DELETE /api/auth/session`
7. `GET /api/auth/pin`
8. `POST /api/auth/pin/verify`
9. `PATCH /api/auth/pin`
10. `DELETE /api/auth/pin`

PIN hashing and verification are compatible with the current Node implementation’s `scrypt` format, and successful PIN verification issues both the signed session cookie and a fresh CSRF cookie.

## Embedding config

For `knowledge-rag`, embedding config resolves in this order:

1. `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL`
2. the current user's active `api_providers` row when it is `openai` or `custom`

That keeps Python search/indexing aligned with the existing provider mechanism without requiring a separate Python-only provider setup.

The Python backend also exposes `POST /api/knowledge-rag/documents/{document_id}/backfill` to fill missing chunk embeddings for an already indexed document. Unlike initial indexing, this endpoint is explicit and returns `409` when no embedding provider is configured.

## Providers

The Python backend now serves:

1. `GET /api/providers`
2. `GET /api/providers/active`
3. `POST /api/providers`
4. `PATCH /api/providers/{provider_id}`
5. `POST /api/providers/{provider_id}/activate`
6. `DELETE /api/providers/{provider_id}`

Responses match the current frontend `src/lib/apiConfig.ts` expectations, including `hasApiKey` and `apiKeyPreview` derived from the existing encrypted provider secret format.

On authenticated requests, the Python backend also performs conservative provider bootstrap from `DEFAULT_PROVIDER_*` env vars:

1. if the user has no providers and `DEFAULT_PROVIDER_BASE_URL` is set, create an active bootstrap provider
2. persist the env hash in `user_settings.provider_config_hash`
3. only auto-sync providers whose `source` is already `bootstrap`

That avoids overwriting user-managed manual providers while still keeping local default-provider flows working.

## Maintenance

The Python backend now serves:

1. `GET /api/maintenance/business-snapshot`
2. `POST /api/maintenance/business-snapshot`
3. `POST /api/maintenance/reset`

These routes are restricted to the current `DEFAULT_USER_ID` user, matching the conservative local-only intent of the TypeScript maintenance surface.

## Agent module

The Python backend now serves the existing agent contract with persisted run-state reconstruction plus Python-side execution loops:

1. `GET /api/agent/health`
2. `GET /api/agent/persona`
3. `PUT /api/agent/persona`
4. `GET /api/agent/sessions`
5. `GET /api/agent/sessions/{session_id}`
6. `POST /api/agent/sessions`
7. `PATCH /api/agent/sessions/{session_id}`
8. `DELETE /api/agent/sessions/{session_id}`
9. `GET /api/agent/runs`
10. `GET /api/agent/runs/{run_id}`
11. `POST /api/agent/runs`
12. `PATCH /api/agent/runs/{run_id}`
13. `DELETE /api/agent/runs/{run_id}`
14. `POST /api/agent/runs/stream`
15. `POST /api/agent/runs/{run_id}/tools/{tool_execution_id}/confirm`
16. `POST /api/agent/runs/{run_id}/tools/{tool_execution_id}/confirm/stream`
17. `POST /api/agent/runs/{run_id}/tools/{tool_execution_id}/reject`
18. `POST /api/agent/runs/{run_id}/tools/{tool_execution_id}/reject/stream`

The current run execution behavior is:

1. it uses the current user's active `anthropic`, `openai`, `gemini`, or `custom` provider through a provider-specific streaming adapter
2. it emits contract-compatible `metadata`, `token`, `run_completed`, and terminal `done` SSE events
3. it parses fresh-run tool calls from model output, executes migrated query tools immediately, and persists waiting-confirmation state for write tools
4. it persists session/run records and reconstructed run state directly on `agent_runs`, including messages, tool-call snapshots, text chunks, timelines, and final text
5. waiting-confirmation runs still expose a placeholder pending tool only when older persisted state has no concrete tool payload
6. completed runs can emit memory events that are consolidated into personal preferences, session goals, session summaries, and session-scoped corpus bindings

Session detail history now aggregates persisted run messages across the session, which lets the Python backend restore the latest conversation history without relying on the removed LangGraph checkpoint tables.

The current memory behavior is intentionally pragmatic rather than overly complex:

1. short-term memory stays on `agent_sessions.memory_*`
2. long-term memory is persisted in `agent_memory_events`, `agent_memory_records`, and `agent_memory_blocks`
3. session RAG context can inherit a corpus binding from prior successful retrieval
4. memory extraction is conservative and rule-based so it is easier to debug in personal-use scenarios

The current tool-decision behavior is:

1. `reject` can safely cancel a `waiting_confirmation` run and returns contract-compatible run detail or stream events
2. `confirm` now executes migrated confirmed write tools for `create_task`, `update_task`, `delete_task`, and `add_finance_record` before continuing with the active `anthropic`, `openai`, `gemini`, or `custom` provider
3. when no concrete pending tool payload is available, the continuation path still falls back to conservative persisted-state continuation instead of claiming full LangGraph checkpoint parity

No remaining unmigrated backend module surface is currently tracked in the Python migration. The residual risk is limited to edge-case live-provider semantics and legacy persisted runs created before concrete pending tool payloads were stored.

## Query preprocessing

When `QUERY_PREPROCESSOR_ENABLED=true`, `knowledge-rag` can preprocess search queries before recall:

1. lightweight local rewrite removes common Chinese stopwords
2. optional multi-query expansion reuses the current user's active `api_providers` chat model when available

If expansion is enabled but no compatible active provider is configured, the Python backend falls back to the original rewritten query instead of failing the search request.

## MMR reranking

When `MMR_ENABLED=true`, `knowledge-rag` can apply Maximal Marginal Relevance diversification after hybrid fusion and before the final limit cut. This reuses stored chunk embeddings already present in `knowledge_chunks` and falls back to the original ranking when candidate embeddings are unavailable.

## Cross-encoder reranking

When `RERANKER_ENABLED=true`, `knowledge-rag` can call the current user's active provider `/rerank` endpoint when that provider has `reranker_model` configured. The Python backend truncates chunk text before reranking, preserves the original ordering when reranking is unavailable, and reports `rerankTimeMs` in search responses when reranking was attempted.

Database integration tests are opt-in. Set `RUN_PYTHON_INTEGRATION_TESTS=1` only when the local Postgres schema is ready and safe to use for test inserts/cleanup.
