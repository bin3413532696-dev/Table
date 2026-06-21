---
name: release
description: 发布版本工作流——bump 版本号、生成中文 commit、打 annotated tag、推送到远端。用户说“推到云端”、“发布版本”、“打 tag”、“版本更新”时触发。
---

# Release 工作流

把工作区改动按一次正式发布处理：版本号 bump → 中文 commit message → annotated git tag → push 到 origin。

## 前置约束（不可违反）

1. **NEVER `git add .` 或 `git add -A`** —— 按文件名逐一 `git add`，避免误带敏感文件（`.env`、credentials）或未审视的产物
2. **NEVER `git push --force` 到 main/master** —— 普通推送出现冲突时，先 pull rebase 或问用户
3. **NEVER `--no-verify` 跳过 hooks** —— hook 失败说明真有问题，修问题而不是绕过
4. **NEVER amend 已推送的 commit** —— 创建新 commit；amend 会改写历史，远端会冲突
5. **不要臆断 `.Codex/` 是本地产物** —— `.Codex/` 在本仓库是项目级治理目录；若本次任务明确改了其中的文档或 skill，应按普通受管文件显式 `git add`
6. **不要把新的项目规范写进 `.claude/`** —— `.claude/` 仅保留历史兼容桥接；新的约定、计划、技能默认进入根 `AGENTS.md` 或 `.Codex/`
7. **不主动改 git config**，不主动删除分支

## 工作流

### Step 1 — 收集状态

并行执行以下只读命令，建立全局观：

```bash
git status
git remote -v
git log --oneline -5
git tag -l
git diff --stat HEAD
```

读 `package.json`、`python-backend/pyproject.toml`、`ocr-service/pyproject.toml` 取当前版本号。读 `uv.lock` 看是否需要同步后端版本。

### Step 2 — 询问决策点

至少确认这 3 项（如果用户已经明确说过，就不要重复问）：

| 决策 | 默认选项 |
|---|---|
| 未跟踪的非任务文件怎么处理 | 一起提交 |
| 版本号 bump 策略 | minor |
| Commit 拆分 | 单个大 commit |

### Step 3 — Bump 版本号

按用户选择更新：

- `package.json` 的 `version` 字段
- `python-backend/pyproject.toml` 的 `version` 字段（若改动涉及后端）
- `ocr-service/pyproject.toml`（仅当本次改了 OCR 服务）
- `uv.lock` 里对应 package 的 `version` 字段（直接编辑，不重跑 `uv lock`，避免依赖漂移）
- README 里的版本号引用（如有）

### Step 4 — Stage 改动

按文件名显式 `git add`，然后用 `git status --short` 确认 staged 列表符合预期。

### Step 5 — 创建 Commit（中文消息）

遵循项目历史风格：

- `feat(scope):` 新功能
- `fix(scope):` bug 修复
- `refactor(scope):` 重构
- `docs:` 文档
- `chore:` 杂项

不要写 “Generated with Codex” 之类的水印。

### Step 6 — 打 Annotated Tag

参考已有 tag 命名（通常带 `v` 前缀，如 `v1.1.0`），不要使用轻量级 tag。

### Step 7 — Push

```bash
git push origin main
git push origin v1.1.0
```

`git push origin main` 不会自动推 tag，必须显式推送。

### Step 8 — 验证

```bash
git log --oneline --decorate -3
git status
```

确认 tag 挂在最新 commit，且工作区 clean。

## 异常处理

- `push` 报 SSL/网络瞬时错误：先用 `git ls-remote` 确认远端实际状态，再决定是否重试
- `push` 被拒（non-fast-forward）：先 `git pull --rebase origin main`，不要 `--force`
- pre-commit hook 失败：修问题，不要 `--no-verify`
- commit message 输入失败：重新提交，不要 amend 已推送 commit

## 项目特定约定

- commit message 用中文
- `.Codex/` 是项目级治理目录；其中的 README、架构债务文档、受管 skill 等资产可以入库，修改时按普通仓库文件管理
- 新的 plan / skill 默认进入 `.Codex/`
- `.claude/` 只保留兼容镜像；除非明确在做兼容同步，否则不要把新的项目规范资产落到 `.claude/`
- `uv.lock` 只改版本字段时直接编辑，不重跑 `uv lock`
