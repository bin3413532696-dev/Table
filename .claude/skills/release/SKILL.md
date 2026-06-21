---
name: release
description: 发布版本工作流——bump 版本号、生成中文 commit、打 annotated tag、推送到远端。用户说"推到云端"、"发布版本"、"打 tag"、"版本更新"时触发。
---

# Release 工作流

把工作区改动按一次正式发布处理：版本号 bump → 中文 commit message → annotated git tag → push 到 origin。

## 前置约束（不可违反）

1. **NEVER `git add .` 或 `git add -A`** —— 按文件名逐一 `git add`，避免误带敏感文件（.env、credentials）或未审视的产物
2. **NEVER `git push --force` 到 main/master** —— 普通推送出现冲突时，先 pull rebase 或问用户
3. **NEVER `--no-verify` 跳过 hooks** —— hook 失败说明真有问题，修问题而不是绕过
4. **NEVER amend 已推送的 commit** —— 创建新 commit；amend 会改写历史，远端会冲突
5. **不要把新的项目规范写进 `.claude/`** —— `.claude/` 是历史兼容目录；新的约定、plan、skill 默认进入根 `AGENTS.md` 或 `.Codex/`
6. **不要臆断 `.Codex/` 是本地产物** —— `.Codex/` 在本仓库是项目级治理目录；若本次任务明确改了其中受管文档或 skill，应按普通仓库文件显式 `git add`
7. **不主动改 git config**，不主动删除分支

## 工作流

### Step 1 — 收集状态

并行执行以下只读命令，建立全局观：

```bash
git status                           # 工作区状态
git remote -v                        # 远端
git log --oneline -5                 # 最近提交风格
git tag -l                           # 已有 tag（学习命名约定）
git diff --stat HEAD                 # 改动统计
```

读 `package.json`、`python-backend/pyproject.toml`、`ocr-service/pyproject.toml` 取当前版本号。读 `uv.lock` 看是否需要同步后端版本。

### Step 2 — 询问决策点（用 AskUserQuestion）

至少问这 3 项（按需扩展）：

| 决策 | 默认选项 |
|---|---|
| **未跟踪的非任务文件**（如 AGENTS.md、IDE 配置）怎么处理 | 一起提交（保持项目自包含） |
| **版本号 bump 策略** | minor（feature 新增） |
| **Commit 拆分** | 单个大 commit（除非本次有 2 个独立特性） |

只在用户没在原始消息里指定时才问——比如用户已经说"按 1.1.0"，就别再问 bump 策略。

### Step 3 — Bump 版本号

按用户选择更新：

- `package.json` 的 `version` 字段
- `python-backend/pyproject.toml` 的 `version` 字段（若改动涉及后端）
- `ocr-service/pyproject.toml`（仅当本次改了 OCR 服务）
- `uv.lock` 里对应 package 的 `version` 字段（用 Edit 工具直接改，不重跑 `uv lock`，避免依赖漂移）
- README 里的 tests badge 数量、版本号引用（如有）

**Edit 之前必须 Read 文件**（Edit 工具要求）。

### Step 4 — Stage 改动

按文件名显式 `git add`，列在一条命令里方便审阅：

```bash
git add \
  AGENTS.md \
  .env.example \
  README.md \
  package.json \
  uv.lock \
  python-backend/pyproject.toml \
  python-backend/app/... \
  prisma/migrations/... \
  src/...
```

然后 `git status --short` 确认 staged 列表符合预期。

### Step 5 — 创建 Commit（中文消息）

用 HEREDOC 传递多行 message，遵循项目历史 commit 风格（看 `git log --oneline -5` 的前缀）：

- `feat(scope):` 新功能
- `fix(scope):` bug 修复
- `refactor(scope):` 重构
- `docs:` 文档
- `chore:` 杂项

Body 按"核心改动"分小节，每节 1-3 行说清楚 why/how：

```bash
git commit -m "$(cat <<'EOF'
feat(rag): 升级 PDF 图文管线

# 核心改动

## 1. 模块名
- 关键变更点 1
- 关键变更点 2

## 测试与版本
- 168 passed
- package.json 1.0.0 → 1.1.0
EOF
)"
```

不要写 "Generated with Claude Code" 之类的水印。

### Step 6 — 打 Annotated Tag

参考已有 tag 命名（多数项目用 `v` 前缀如 `v1.1.0`）。Tag message 含 release notes 摘要：

```bash
git tag -a v1.1.0 -m "$(cat <<'EOF'
v1.1.0 — 简短标题

主要特性：
- 特性 1
- 特性 2

测试：N passed
EOF
)"
```

**不要用轻量级 tag**（`git tag v1.1.0`），annotated tag 才能在 GitHub Releases 显示 release notes。

### Step 7 — Push

```bash
git push origin main          # 推分支
git push origin v1.1.0        # 推 tag（必须分开 push，不会自动跟分支）
```

**注意**：`git push origin main` **不会**自动推 tag，必须显式 `git push origin <tag>`。

### Step 8 — 验证

```bash
git log --oneline --decorate -3    # 确认 tag 附在最新 commit
git status                          # 应该 "working tree clean"
```

提示用户可在 GitHub Releases 页面把 annotated tag 一键转 Release（链接形式：`https://github.com/<owner>/<repo>/releases/new?tag=v1.1.0`）。

## 异常处理

- **push 报 SSL/网络瞬时错误**：通常是握手抖动，先查 `git log --decorate` 看 tag 是否本地正确，远端 push 多半已成功。重试时先 `git ls-remote` 确认状态。
- **push 被拒（non-fast-forward）**：远端有新 commit。先 `git pull --rebase origin main` 再 push。绝不要 `--force`。
- **pre-commit hook 失败**：hook 是项目治理的一部分，修问题（lint 错误、type 错误等），不要 `--no-verify`。
- **commit message 输入失败**：通常是引号转义问题，HEREDOC 应能避免；若失败，重新 stage 并新建 commit（不要 amend）。

## 项目特定约定

- **commit message 用中文**（README/CLAUDE.md 均中文，保持一致）
- **`.Codex/` 是当前项目级 AI 协作主目录**；新的 plan / skill 默认进入 `.Codex/`
- **`.claude/` 只保留兼容镜像**；只有在同步历史 Claude 兼容文档或既有 tracked skill 时，才显式提交相关 `.claude/` 文件
- **项目规范以根 `AGENTS.md` 与 `.Codex/` 为准**，不要把 `.claude/` 扩展成第二套独立规范
- **uv.lock 直接 Edit 版本字段**，不重跑 `uv lock`，避免引入未审核的依赖更新
