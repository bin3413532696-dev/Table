# Repository Guidelines

## 项目结构与模块组织
本仓库是前后端双栈项目。前端代码位于 `src/`，按领域拆分为 `pages/`、`components/`、`agent/`、`lib/`、`hooks/` 等。Python 后端位于 `python-backend/app/`，包含 `api/routes/`、`services/`、`repositories/`、`schemas/` 和 `db/`。数据库 schema 与迁移在 `prisma/`。端到端与烟雾测试脚本在 `scripts/`，前端 API 测试在 `tests/frontend-api/`，后端测试在 `python-backend/tests/`。

## 构建、测试与开发命令
- `npm run dev`：启动 Webpack 前端开发服务器。
- `npm run build`：构建前端生产包到 `dist/`。
- `npm run typecheck`：执行 TypeScript 类型检查。
- `npm run test:frontend-api`：编译并运行前端 API 测试。
- `npm run backend:sync`：用 `uv` 同步 Python 后端依赖。
- `npm run backend:dev`：本地启动 FastAPI，地址 `127.0.0.1:8787`。
- `npm run backend:test`：运行后端 pytest 测试。
- `npm run knowledge:smoke`、`npm run modules:smoke`：运行关键功能烟雾测试。

## 编码风格与命名约定
前端使用 TypeScript/React，默认 2 空格缩进，组件名用 `PascalCase`，hooks 用 `useXxx`，工具函数与状态模块用 `camelCase`。后端使用 Python 3.11，遵循 PEP 8，4 空格缩进，模块与函数用 `snake_case`，Pydantic schema 使用清晰的业务命名。优先做小而明确的改动，避免跨层混合重构。

## 测试规范
前端测试文件放在 `tests/frontend-api/*.test.ts`。后端测试文件命名为 `python-backend/tests/test_*.py`，异步测试使用 `pytest-asyncio`。提交前至少运行与改动相关的测试；涉及 Agent、RAG、搜索或流式接口时，补充回归测试而不是只做手工验证。

## 提交与 Pull Request 规范
现有历史同时存在中文提交和 `feat:` 前缀，建议统一使用“动词 + 范围”的简短主题，例如 `feat: 完善 RAG 检索过滤`、`fix: 修复 agent SSE 解析`。PR 应说明变更目的、影响范围、测试结果；UI 改动附截图，接口或行为变更附示例请求/响应。

## 安全与配置提示
不要提交 `.env`、密钥或真实测试数据。优先使用 `.env.example` 作为配置模板。涉及 Prisma 迁移、Provider、OCR 或 Agent 运行时配置时，确保本地验证后再提交。
