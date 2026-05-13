# 项目代码生成规范

## 项目概述

- **前端**：React 18 + TypeScript + Webpack 5 + Tailwind CSS + TipTap + Framer Motion
- **后端**：Fastify 5 + Prisma 6 + PostgreSQL
- **认证**：HMAC-SHA256 签名 Cookie + PIN 验证
- **状态**：事件驱动内存 Store + 服务端权威同步

## 语言规范

- 所有对话和文档都使用中文
- 注释使用中文
- 错误提示使用中文
- 文档使用中文Markdown格式

---

## 模块结构

后端每模块五层：`routes.ts` → `service.ts` → `repository.ts` → `schema.ts`（+ `dto.ts` 可选）

### routes.ts

- 命名：`xxxRoutes`
- 每个端点 `try-catch` + `sendInfrastructureError`
- GET `/` → 列表，POST `/` → 201，GET `/:id` → 单条，DELETE `/:id` → 204

### schema.ts

- 枚举：`z.enum()`
- ID 参数：`{ id: z.string().uuid() }`
- 字符串必加 `.trim().min(1).max(N)`
- nullable 字段：`.max()` 在前，`.nullable()` 在后
- 长度约束：title(200)、description(500)、notes(5000)、amount(999999999.99)、tags(max 20)
- 导出类型：`z.infer<typeof schema>`

### repository.ts

- **所有查询 WHERE 必须含 `userId`**（防止跨用户访问）
- 更新：WHERE 含 `userId` + `version`（乐观锁）
- 软删除：`deletedAt` 字段

### service.ts

- 封装 repository，处理业务逻辑
- 函数命名：`getList`、`getDetail`、`createRecord`、`updateRecord`

### 权限与速率

- 敏感端点：`preHandler` 检查
- 全局：100/min，导入/重置：1/min，PIN 验证：5/5min

---

## 前端规范

### 组件

- 命名：PascalCase
- hooks 在顶部，事件处理函数 `handle` 前缀
- useEffect 订阅事件，返回 unsubscribe

### API 调用

- 使用 `fetchWithAuth`（自动携带 Cookie）
- CRUD 封装在 `db/index.ts`

### Store

- 继承 BaseStore，实现 `loadFromStorage`、`saveToStorage`、`validate`、`validateCreateDTO`
- `hydrate` 由 db 层调用

---

## 安全规范

| 规则     | 要求                                                         |
| -------- | ------------------------------------------------------------ |
| 认证     | 签名 Cookie：`<userId>.<expires>.<signature>`，PIN scrypt 哈希 |
| 输入     | 字符串/数值/数组必须有 `.max()` 限制，version 有 `.min(1)`   |
| 数据访问 | WHERE 必须含 `userId`，更新含 `version`                      |
| fetch    | 必须有 `AbortController` 超时（120s）                        |

---

## Git规范

- 使用conventional commits
- feat: 新功能
- fix: 修复bug
- docs: 文档更新
- refactor: 代码重构

## 开发原则

- 单一职责原则
- 每个PR只解决一个问题
- 代码必须有单元测试
- 注释用中文，代码用英文

---

## 文件命名

| 类型      | 规范   | 示例           |
| --------- | ------ | -------------- |
| 后端模块  | 小驼峰 | `routes.ts`    |
| 前端组件  | 大驼峰 | `TaskList.tsx` |
| 类型/配置 | 小驼峰 | `types.ts`     |

---

## 代码风格

- 单一职责，函数名动词开头
- 不写无用注释，仅在 WHY 不显而易见时添加
- 命名导出，避免默认导出
- 使用 TypeScript 类型推断，`z.infer` 推断类型

---

## 常见陷阱

1. Repository 缺 userId → 跨用户访问漏洞
2. Zod 缺 `.max()` → 允许恶意 payload
3. fetch 无超时 → 服务器挂起
4. Cookie 无签名 → 可被篡改
5. 软删除不一致 → 垃圾数据
6. 无优雅关闭 → Prisma 连接泄漏
7. 内存无清理 → 内存无限增长

---

## 参考

- 架构详情：`ARCHITECTURE.md`，文件路径Table\docs
- 后端示例：`server/src/modules/tasks/`
- 前端示例：`src/db/index.ts`
