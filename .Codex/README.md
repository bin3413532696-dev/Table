# Codex Project Assets

项目级 Codex 产物统一保存在 `.Codex/`，避免计划、技能和结构治理信息散落到仓库外部。

- `plans/`：项目内规划文档
- `skills/`：项目内技能
- `architecture-debt.md`：结构历史债务与冻结例外清单
- 根 `AGENTS.md`：仓库级规范与项目偏好主入口

约定补充：

- `.Codex/` 是当前项目级 AI 协作主目录。
- `.claude/`、`.agents/` 仅视为历史或并存工具目录，兼容保留，不再作为新增项目约定的首选位置。
- 项目规范以根 `AGENTS.md` 和 `.Codex/` 为单一事实来源；若仍保留 `.claude/` 兼容文档，它们只应同步必要桥接信息，不应形成第二套独立规范。
