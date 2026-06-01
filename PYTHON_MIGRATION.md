# Python Migration Notes

## Final status

The Python backend migration is now the official backend implementation for this repository.

- `python-backend/` is the only supported application backend
- `ocr-service/` remains a separate Python service managed by the same `uv` workspace
- the legacy TypeScript backend is no longer the official runtime path

## Recommended commands

```bash
uv sync --package table-python-backend
uv sync --package table-ocr-service
uv run --package table-python-backend uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload
uv run --package table-ocr-service uvicorn main:app --host 127.0.0.1 --port 8001
uv run --package table-python-backend pytest python-backend/tests -q
```

## Implemented backend surface

- root `uv` workspace and Python version pinning
- FastAPI app config, middleware, CSRF handling, DB session wiring
- `/api/auth`
- `/api/tasks`
- `/api/finance`
- `/api/knowledge`
- `/api/knowledge-rag`
- `/api/providers`
- `/api/maintenance`
- `/api/agent`
- OCR service moved from `requirements.txt`-only to `pyproject.toml`

## Verified baseline

- Python backend test result: `102 passed, 5 skipped`
- front-end contract layer has been reworked to depend on unified HTTP APIs only
- remaining direct non-client HTTP usage is intentionally limited to auth handling and agent SSE streaming flows

## Remaining risk

There is no known remaining unmigrated backend module in the current API surface.

The remaining risk is behavior parity in edge cases inside already migrated modules, mainly:

- live provider semantics
- legacy persisted agent runs from older data shapes
- long-tail agent confirmation / streaming behaviors
