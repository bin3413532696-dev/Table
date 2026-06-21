# 贡献指南

感谢您考虑为 Table 贡献代码。本文档说明了参与开发的规范。

在开始前请注意项目定位：Table 不是一个泛化的团队协作平台，当前核心方向是**个人从大体量资料中持续学习新知识**。涉及产品文案、交互、数据模型或 Agent 设计时，请优先服务这个主场景。

## 开发环境搭建

参见 [README.md](./README.md#快速开始) 的本地开发环境配置。

## 代码风格

- **前端 (TypeScript/React)**：2 空格缩进，组件使用 `PascalCase`，工具函数和 hooks 使用 `camelCase`
- **后端 (Python)**：遵循 PEP 8，4 空格缩进，模块和函数使用 `snake_case`
- **数据库**：Prisma schema 使用 `snake_case` 命名，通过 `@map` 映射

## 提交前检查

1. TypeScript 类型检查通过：`npm run typecheck`
2. Lint 通过：`npm run lint`
3. 前端契约 / DOM 交互测试通过：`npm run test:frontend-api`
4. 后端分层测试通过：`npm run backend:test:ci`
5. OCR 测试通过：`npm run ocr:test`
6. 规范检查通过：`npm run check:conventions`
7. 涉及前端路由、构建配置、样式入口或动态 import 时，生产构建通过：`npm run build`
8. Bundle 基线检查通过：`npm run check:bundle-size`
9. 运行相关烟雾测试（`npm run smoke:basic` 会自动拉起并清理本地后端）

## 推送前自检清单

如果只是日常小改动，至少按下面顺序执行一遍，避免“本地能用，CI 红叉”：

1. 先看工作区状态：`git status`
2. 跑前端静态检查：`npm run lint`、`npm run typecheck`
3. 跑前端契约 / 交互测试：`npm run test:frontend-api`
4. 涉及页面入口、动态 import、构建配置、依赖升级时，补跑：`npm run build`、`npm run check:bundle-size`
5. 涉及 Python 后端、数据库、知识库、Agent、OCR 时，补跑：`npm run backend:test:ci`、`npm run ocr:test`
6. 涉及关键业务链路时，补跑对应 smoke：`npm run smoke:basic`、`npm run knowledge-rag:smoke` 等

推荐的最小发布前入口：

```bash
npm run prepush:check
```

若本次改动覆盖后端或 OCR，再继续执行：

```bash
npm run prepush:check:full
```

`npm run prepush:check:full` 当前会额外覆盖：

- `npm run backend:test:ci`
- `npm run ocr:test`
- `npm run smoke:basic`

注意事项：

- GitHub Actions 默认跑在 Linux；本地 Windows 能通过的路径写法、通配符、大小写引用，在 CI 里不一定同样成立
- `git push` 成功只代表代码已上传，不代表 CI 已通过；红叉通常是检查失败，不是上传失败
- 优先复用 `package.json` 里的脚本，不要在推送前手写一串只在本机 shell 下成立的临时命令
- 如果本次是发布或大规模重构，优先跑 `npm run check`

## 测试分层

- `unit`：纯函数、schema、工具函数、无需真实基础设施的服务逻辑
- `integration`：真实 PostgreSQL、repository/service 跨层逻辑、真实 schema 依赖
- `startup`：FastAPI `lifespan`、数据库启动期清理、副作用与 fail-fast 行为
- `conventions`：文档、目录、边界、公开入口、错误契约等仓库规则
- `frontend-api`：前端 API 契约、结构约束与关键 DOM 交互
- `smoke`：已启动服务上的关键业务最小可用路径
- `e2e`：CDP / 浏览器级完整流程

后端启动策略采用 `fail-fast`：数据库不可用、关键迁移缺失或启动前置条件不满足时，服务应直接启动失败；修复时必须补充 `startup` 或 `integration` 覆盖，而不是只加依赖 override 的 API 测试。

当前前端关键交互回归至少覆盖：

- `App` / `PinLock`
- `DocumentUploader`
- `RagSection` 的上传、资料集、检索、详情与详情动作

## 变更原则

- 优先增强多格式资料解析、RAG 检索质量、Agent 对话可用性与个人记忆体验
- 不要把项目重新扩展成重型团队协作系统
- 涉及文档描述时，不要把项目表述成仅支持 PDF；应覆盖 PDF、Markdown、TXT、扫描件等大文件场景
- `app` 层只能编排 feature 公共入口，不要直接依赖 feature 深层模块
- `app` 层引入 feature 时只能走 `public.ts` 或 `page.ts` 入口，包含 `lazy(() => import(...))` 的动态导入
- `components` 只保留通用 UI / 壳层组件，不要反向依赖具体业务 feature
- 不要继续向 `app.services.agent.__init__`、`app.services.knowledge_rag` 这类兼容入口新增私有 helper 导出
- `app.services.agent.public`、`app.services.knowledge_rag_public` 是正式公开入口；兼容 facade 只允许保留既有导出，不再扩展
- 前端结构测试中的 allowlist 只用于少量历史例外；新增 barrel / 例外必须在 PR 中说明必要性与后续收口方式
- 新增兼容层或 bundle 明显变大时，必须在 PR 描述里说明原因
- `npm run check:bundle-size` 通过只代表“没有明显回退”；若输出仍提示 tracked bundle 超过告警阈值，修改相关页面或依赖时应优先顺手削减

## 提交信息规范

使用简洁的提交信息，中英文均可，例如：
- `feat: 添加知识库高级筛选`
- `fix: 修复 agent SSE 断线重连`
- `chore: 更新依赖版本`

## Pull Request 流程

1. 在 PR 描述中关联相关 Issue
2. UI 改动附截图
3. API 改动附示例请求/响应
4. 确保 CI 通过后再请求 Review
