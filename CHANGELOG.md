# 更新日志

## [Unreleased]

### 文档
- 统一 Markdown 文档中的项目定位：从“通用个人工作台”收敛为“面向个人、服务大文件学习场景的 RAG + Agent 应用”
- 更正文档表述，避免将知识库场景错误限制为仅 PDF，统一覆盖 PDF、Markdown、TXT、扫描件等资料类型

### Agent / Memory
- 新增长时记忆持久层：`agent_memory_events`、`agent_memory_records`、`agent_memory_blocks`
- Agent 会话支持资料集感知的长期记忆与会话级语料绑定
- RAG 工具在会话内可根据资料集记忆自动缩小检索文档范围
- 优化记忆抽取逻辑：复合指令拆分为偏好、规则、目标，减少冗余记忆
- 修复清空会话记忆时 session 级 memory block 残留问题

### RAG
- 新增资料集（corpus）模型、接口与前端基础管理能力
- 为知识文档响应补充 `corpusIds`，支持资料归组与会话级检索收缩

### 仓库整理
- 删除开发垃圾文件（.tmp/、server/data/、大模型发展历程.txt、__pycache__、.pytest_cache）
- 更新 .gitignore 补充常见模式（.DS_Store、.idea/、.vscode/、*.swp 等）
- 添加 .gitattributes 统一跨平台行尾处理
- 添加 .dockerignore 减少构建上下文
- 修复 package.json 元数据（名称、许可证、private 标记）
- 清理 webpack.config.js 中未声明的依赖别名
- 添加 ESLint 基础配置和 Ruff 配置
- 归档 PYTHON_MIGRATION.md 到 README 迁移说明
- 统一 .md 文档为中文
- 扩充 SECURITY.md 安全策略内容
- 完善 CHANGELOG.md 历史记录
- 添加 ocr:dev 脚本并修复 ocr-service README
- 同步 .env.example 配置模板

## [1.0.0] - 2026-06-02

### 新增
- Python 后端迁移完成：FastAPI + SQLAlchemy + PostgreSQL
- Agent 模块集成 LangGraph 与会话记忆
- RAG 知识库支持混合检索、MMR 重排、Cross-encoder 重排
- 查询预处理支持中文停用词去除与多查询扩展
- Provider 管理支持加密 API 密钥存储
- OCR 文档处理服务
- Agent、RAG、知识库及模块的烟雾测试和端到端测试

### 修复
- P0 乐观锁并发问题（任务/财务更新）
- 安全漏洞（12 项）：依赖升级、输入校验、CSRF 加固
- Bootstrap Provider 自动创建时序错误
- 设置页数据统计不一致

### 变更
- Agent 架构全面迁移到 LangGraph
- 前端 API 层统一使用 HTTP 客户端
- 移除遗留 TypeScript 后端
- 更新文档与开发规范
