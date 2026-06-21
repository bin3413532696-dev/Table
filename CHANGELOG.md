# 更新日志

## [1.2.1] - 2026-06-20

### 测试与工程化
- 规范化后端测试分层：`unit` / `integration` / `startup` / `conventions`
- 为 OCR 服务补充独立轻量测试入口 `npm run ocr:test`
- 为 `smoke:basic` 增加自动拉起与清理后端的脚本化能力
- 扩展前端测试，从 API 契约覆盖到关键 DOM 交互链路

### 前端测试覆盖
- 新增 `App` / `PinLock` / `DocumentUploader` 交互测试
- 新增 `RagSection` 上传、资料集创建、检索、打开详情、重新索引、加入资料集测试
- 修正 Node + JSDOM 环境下 `testing-library` 初始化顺序，稳定 React 受控输入测试

### 文档
- 同步 README、贡献指南、后端与 OCR 说明文档，统一反映新的测试体系与 smoke 行为

## [1.2.0] - 2026-06-19

### 概述
- 项目定位进一步收敛为“面向个人、从大体量资料中持续学习新知识”的 RAG + Agent 工作台

### 亮点
- 新增资料集（corpus）能力，可将同主题资料归组并用于会话级检索收缩
- 新增 Agent 长时记忆持久层，支持偏好、规则、目标、摘要与资料集绑定
- 优化会话内 RAG 行为，围绕同一资料持续提问时可自动收缩检索范围
- 完善项目文档，统一覆盖 PDF、Markdown、TXT、扫描件等多格式资料场景

### 验证
- 后端测试、前端契约测试与 TypeScript 类型检查均已通过
- 已在真实 PostgreSQL 环境完成最小记忆链路与资料集检索收缩验证

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
