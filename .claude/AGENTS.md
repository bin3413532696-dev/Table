# Claude Compatibility Guidelines

`.claude/` 在本项目中是历史兼容目录，不是新的项目规范主入口。仓库级规范以根 `AGENTS.md` 和 `.Codex/` 下的治理文档为准；如果这里与根文档冲突，以根文档为准。

## 当前项目结构

- 前端正式结构是 `src/app/`、`src/features/<domain>/`、`src/shared/`、`src/core/`。
- 旧的 `src/pages/`、`src/lib/`、`src/agent/` 只应作为历史迁移语境理解，不再是新的结构约定。
- 后端正式结构是 `python-backend/app/api/routes/`、`services/`、`repositories/`、`schemas/`、`db/`。
- 项目级 AI 协作主目录是 `.Codex/`；`.claude/` 仅保留必要的兼容镜像与桥接说明。

## 当前命令约定

```bash
npm run dev
npm run backend:dev
npm run ocr:dev
npm run test:frontend-api
npm run typecheck
uv run --default-index https://pypi.org/simple --package table-python-backend pytest python-backend/tests -q
```

## 同步规则

- 新的 plan 默认放 `.Codex/plans/`。
- 新的 skill 默认放 `.Codex/skills/`。
- 项目偏好与仓库级约定写在根 `AGENTS.md`，不要继续把 `.claude/` 演化成第二事实来源。
- 如果历史 Claude 工具仍读取 `.claude/` 文档，只保留最小必要的兼容镜像，并在更新根规范后再同步这里。
