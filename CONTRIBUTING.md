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
2. 前端 API 测试通过：`npm run test:frontend-api`
3. 后端 pytest 测试通过：`npm run backend:test`
4. 运行相关烟雾测试

## 变更原则

- 优先增强多格式资料解析、RAG 检索质量、Agent 对话可用性与个人记忆体验
- 不要把项目重新扩展成重型团队协作系统
- 涉及文档描述时，不要把项目表述成仅支持 PDF；应覆盖 PDF、Markdown、TXT、扫描件等大文件场景

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
