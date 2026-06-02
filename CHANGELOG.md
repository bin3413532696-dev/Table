# 更新日志

## [Unreleased]

### 仓库整理
- 清理开发产物并补充 GitHub 标准文件

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
