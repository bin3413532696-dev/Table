# Table

`Table` 是一个面向持续扩展的智能工作台平台底座，当前交付内容包括：

- React 前端工作台
- Fastify + Prisma 后端服务
- PostgreSQL 权威数据模型
- LangGraph 智能体执行引擎
- 知识库、任务、财务、Provider 基础能力

## 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Webpack 5 + Tailwind CSS |
| 后端 | Fastify 5 + Prisma 6 + PostgreSQL |
| 智能体 | LangGraph StateGraph + LangChain ChatModel |
| 认证 | HMAC-SHA256 签名 Cookie + PIN 验证 |

## 运行要求

- Node.js 18+
- npm
- PostgreSQL

## 快速启动

1. 安装依赖：`npm install`
2. 复制环境变量：将 `.env.example` 复制为 `.env`
3. 配置数据库：设置 `.env` 中的 `DATABASE_URL`
4. 执行迁移：`npx prisma migrate deploy`
5. 初始化数据：`npm run server:seed`
6. 启动后端：`npm run server:dev`
7. 启动前端：`npm run dev`

### 端口占用处理

如果启动后端时提示端口 8787 已被占用：

```bash
# 方法一：PowerShell 直接杀死占用进程
Get-Process -Id (Get-NetTCPConnection -LocalPort 8787).OwningProcess | Stop-Process -Force

# 方法二：手动查找并杀死进程
# 1. 查找占用端口的进程 PID
netstat -ano | findstr :8787
# 输出示例：TCP 127.0.0.1:8787 0.0.0.0:0 LISTENING 12345
# 最后的数字 12345 就是 PID

# 2. 杀死进程
taskkill /PID 12345 /F
```

处理完成后重新运行 `npm run server:dev`。

## 构建命令

- 前端类型检查：`npm run typecheck`
- 后端类型检查：`npm run server:typecheck`
- 前端构建：`npm run build`
- 后端构建：`npm run server:build`

## 目录说明

- `src/`：前端应用
- `server/`：后端 API 与运行时
- `prisma/`：数据库 schema 与 migration
- `scripts/`：冒烟、端到端与辅助脚本

## 交付说明

仓库已移除研发交接文档、构建产物、本地调试数据与本地工具目录，当前内容以直接交付和部署所需最小集为准。
