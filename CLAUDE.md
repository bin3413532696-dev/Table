# 项目代码生成规范

本文档定义了 `personal-workspace` 项目的代码生成规范。在执行计划编写代码时，必须参考本规范。

---

## 项目概述

这是一个 **全栈个人工作空间应用**，采用前后端分离架构：
- **前端**：React 18 + TypeScript + Webpack 5 + Tailwind CSS + TipTap + Framer Motion
- **后端**：Fastify 5 + Prisma 6 + PostgreSQL
- **认证**：HMAC-SHA256 签名 Cookie + PIN 验证
- **状态管理**：事件驱动的内存 Store + 服务端权威同步

---

## 后端代码规范

### 模块结构

每个业务模块必须遵循五层结构：

```
modules/<name>/
├── routes.ts      # 路由层：HTTP 端点定义
├── service.ts     # 服务层：业务逻辑与所有权检查
├── repository.ts  # 仓储层：Prisma 数据访问
├── schema.ts      # Schema 层：Zod 输入/输出验证
└── dto.ts         # DTO 层：实体到响应转换（可选）
```

### routes.ts 规范

```typescript
// 1. 导入顺序：类型 → schema → service → shared
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createSchema, idParamSchema, updateSchema } from './schema';
import { sendInfrastructureError } from '../../shared/http';
import { createRecord, deleteRecord, getDetail, getList } from './service';

// 2. 路由函数命名：<module>Routes
export async function taskRoutes(app: FastifyInstance) {
  // 3. 每个端点使用 try-catch + sendInfrastructureError
  app.get('/', async (_request, reply) => {
    try {
      const items = await getList();
      return { items, total: items.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 4. POST 返回 201 + { data, source }
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = createSchema.parse(request.body);
      const record = await createRecord(payload);
      return reply.code(201).send({ data: record, source: 'postgres' });
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 5. 单条查询：404 处理
  app.get('/:id', async (request, reply) => {
    try {
      const { id } = idParamSchema.parse(request.params);
      const record = await getDetail(id);
      if (!record) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Record not found' });
      }
      return { data: record, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 6. DELETE 返回 204
  app.delete('/:id', async (request, reply) => {
    try {
      const { id } = idParamSchema.parse(request.params);
      const record = await deleteRecord(id);
      if (!record) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Record not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}
```

### schema.ts 规范

```typescript
import { z } from 'zod';

// 1. 枚举使用 z.enum()
export const prioritySchema = z.enum(['low', 'medium', 'high']);

// 2. ID 参数 Schema
export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// 3. 创建 Schema：字符串必加 trim().min(1).max(N)
export const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  completed: z.boolean().optional(),
  priority: prioritySchema.default('medium'),
});

// 4. 更新 Schema：可选字段，nullable 字段先 .max() 后 .nullable()
export const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  version: z.number().int().min(1).optional(),  // 乐观锁版本号
}).refine((value) => Object.keys(value).filter((k) => k !== 'version').length > 0, {
  message: 'At least one field must be provided',
});

// 5. 导出推断类型
export type CreateInput = z.infer<typeof createSchema>;
export type UpdateInput = z.infer<typeof updateSchema>;
```

**长度约束参考**：
- `title`：max(200)
- `description`：max(500)
- `notes/content`：max(5000) ~ max(50000)
- `category`：max(100)
- `amount`：max(999999999.99)
- `tags` 数组：max(20)，每项 max(50)
- `color`：max(7)（#RRGGBB）
- `version`：min(1)

### repository.ts 规范

```typescript
import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import type { CreateInput, UpdateInput } from './schema';

// 1. 所有查询必须含 userId 过滤（防止跨用户访问）
export async function listRecords() {
  return prisma.task.findMany({
    where: {
      userId: getCurrentUserId(),
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
  });
}

// 2. 单条查询也要含 userId
export async function findById(id: string) {
  return prisma.task.findFirst({
    where: { id, userId: getCurrentUserId(), deletedAt: null },
  });
}

// 3. 更新操作：WHERE 含 userId + version（乐观锁）
export async function updateRecord(id: string, input: UpdateInput) {
  return prisma.task.update({
    where: {
      id,
      userId: getCurrentUserId(),
      ...(input.version !== undefined ? { version: input.version } : {}),
    },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      version: { increment: 1 },  // 每次更新自增版本号
    },
  });
}

// 4. 软删除：WHERE 含 userId
export async function softDeleteRecord(id: string) {
  return prisma.task.update({
    where: { id, userId: getCurrentUserId() },
    data: {
      deletedAt: new Date(),
      version: { increment: 1 },
    },
  });
}
```

### service.ts 规范

```typescript
import * as repository from './repository';
import type { CreateInput, UpdateInput } from './schema';

// 1. 服务层封装 repository，处理业务逻辑
export async function getList() {
  return repository.listRecords();
}

export async function getDetail(id: string) {
  return repository.findById(id);
}

// 2. 创建时调用 repository
export async function createRecord(input: CreateInput) {
  return repository.createRecord(input);
}

// 3. 更新前可添加业务校验
export async function updateRecord(id: string, input: UpdateInput) {
  // 可在此添加业务校验逻辑
  return repository.updateRecord(id, input);
}
```

### 权限保护规范

敏感端点必须添加 `preHandler` 权限检查：

```typescript
// routes.ts
const defaultUserOnly = {
  preHandler: [
    async (request: FastifyRequest, reply: FastifyReply) => {
      const context = resolveRequestUserContext(request);
      if (context.userId !== getDefaultUserId()) {
        throw new AuthError('Only default user can access', 403, 'FORBIDDEN');
      }
    },
  ],
};

app.post('/reset', {
  config: { rateLimit: { max: 1, timeWindow: '1 minute' } },
  ...defaultUserOnly,
}, async (request, reply) => { ... });
```

### 速率限制规范

| 端点类型 | 限制 |
|---------|------|
| 全局 | 100 次/分钟 |
| 导入/重置 | 1 次/分钟 |
| PIN 验证 | 5 次/5分钟 |

---

## 前端代码规范

### 组件结构

```typescript
// 1. 导入顺序：React → 外部库 → 内部模块 → 类型
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { eventEmitter, EventTopics } from '../core/events';
import { useDB } from '../db';
import type { Task } from '../core/types';

// 2. 组件命名：PascalCase
export function TaskList() {
  // 3. hooks 在顶部
  const [tasks, setTasks] = useState<Task[]>([]);
  const { data, loading } = useDB(() => fetchTasks());

  // 4. useEffect 订阅事件
  useEffect(() => {
    const unsubscribe = eventEmitter.on(EventTopics.TASKS_CHANGED, () => {
      // 处理事件
    });
    return unsubscribe;
  }, []);

  // 5. 事件处理函数用 handle 前缀
  const handleDelete = async (id: string) => {
    await taskDB.delete(id);
  };

  // 6. 渲染逻辑
  return (
    <div className="...">
      {tasks.map(task => (
        <TaskItem key={task.id} task={task} onDelete={handleDelete} />
      ))}
    </div>
  );
}
```

### API 调用规范

```typescript
// 1. 使用 fetchWithAuth（自动携带 Cookie）
import { fetchWithAuth } from '../lib/auth';

// 2. CRUD 封装在 db/index.ts
export const taskDB = {
  getAll: async () => {
    const response = await fetchWithAuth('/api/tasks');
    const data = await response.json();
    // hydrate 到 Store 并发射事件
    hydrateTaskCache(data.items);
    return data.items;
  },

  add: async (input: CreateTaskInput) => {
    const response = await fetchWithAuth('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    hydrateTaskCache([...store.getAll(), data.data], true);
    return data.data;
  },
};
```

### Store 规范

```typescript
// BaseStore 子类必须实现四个抽象方法
class TaskStore extends BaseStore<Task, CreateTaskInput, UpdateTaskInput> {
  protected loadFromStorage(): Task[] {
    return [];  // 当前禁用 localStorage
  }

  protected saveToStorage(data: Task[]): void {
    // 当前禁用，storageKey 含 _cache_disabled
  }

  protected validate(entity: unknown): entity is Task {
    return isValidTask(entity);
  }

  protected validateCreateDTO(dto: unknown): dto is CreateTaskInput {
    return isValidCreateTaskDTO(dto);
  }

  // hydrate 由 db 层调用
  hydrate(records: Task[], emit = false) {
    this.data = records;
    if (emit) {
      eventEmitter.emit(this.changeTopic);
    }
  }
}
```

---

## 安全规范

### 认证机制

- **签名 Cookie**：HMAC-SHA256 签名，格式 `<userId>.<expiresTimestamp>.<signature>`
- **x-user-id 头**：默认不信任（`TRUST_USER_ID_HEADER: false`）
- **PIN 验证**：scrypt 哈希，通过后签发 24h 有效签名 Cookie
- **未设 PIN 兼容**：裸 UUID Cookie 可用（本地开发场景）

### 输入验证

- 所有字符串字段必须有 `.max()` 长度限制
- 数值字段必须有 `.max()` 上界（如 amount ≤ 999999999.99）
- 数组字段必须有 `.max()` 元素数量限制
- version 字段必须有 `.min(1)`（乐观锁）

### 数据访问

- 所有 Repository WHERE 条件必须含 `userId`
- 更新/删除操作 WHERE 含 `userId` + `version`（TOCTOU 防护）

### 资源管理

- 外部 fetch 必须有 `AbortController` 超时（推荐 120s）
- 内存 Map/Set 必须有清理机制（写入时清理过期或定期扫描）

---

## 测试规范

项目目前无自动化测试，依赖手动验证：

1. **TypeScript 编译**：`npx tsc --noEmit`
2. **服务器启动**：重启后端验证功能
3. **端点测试**：`curl` 测试 API 响应
4. **正向测试**：攻击向量被拦截（返回 400/403）
5. **反向测试**：正常功能不受影响

---

## Git 提交规范

### 提交信息格式

```text
<类型>: <简短描述>

<详细说明>

<关联问题>
```

类型：
- `feat`：新功能
- `fix`：修复 bug
- `refactor`：重构
- `docs`：文档变更
- `style`：代码格式
- `test`：测试
- `chore`：构建/工具

### 示例

```text
fix: 修复任务更新时的乐观锁冲突问题

- Repository WHERE 条件补充 version 过滤
- 更新失败返回 409 VERSION_CONFLICT
- 前端捕获冲突并提示用户刷新

关联 #123
```

---

## 文件命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 后端模块文件 | 小驼峰 | `routes.ts`, `service.ts`, `repository.ts` |
| 前端组件文件 | 大驼峰 | `TaskList.tsx`, `AgentPanel.tsx` |
| 类型文件 | 小驼峰 | `types.ts`, `base.ts` |
| 配置文件 | 小驼峰或大驼峰 | `config.ts`, `webpack.config.js` |
| 样式文件 | 小驼峰 | `button.css`, `sidebar.css` |

---

## 代码风格要点

### 注释

- 不写无用注释（代码本身应清晰）
- 仅在 WHY 不显而易见时添加注释
- 使用单行注释，避免多行注释块

### 函数

- 单一职责，一个函数只做一件事
- 函数名动词开头：`create`, `update`, `delete`, `get`, `list`, `find`
- Repository 函数命名：`list<X>`, `create<X>`, `find<X>ById`, `update<X>`, `softDelete<X>`

### 导出

- 使用命名导出（`export function ...`），避免默认导出
- 模块入口使用 barrel 文件（`index.ts`）

### 类型

- 使用 TypeScript 类型推断，避免过度标注
- 共享类型定义在 `core/types/` 或 `schema.ts`
- 使用 `z.infer` 从 Zod schema 推断类型

---

## 常见陷阱

1. **Repository 缺 userId**：会导致跨用户数据访问漏洞
2. **Zod 缺 .max()**：允许恶意超大 payload
3. **fetch 无超时**：Provider 无响应时服务器挂起
4. **速率限制白名单**：localhost 白名单可被利用绕过限制
5. **Cookie 无签名**：可被篡改冒充其他用户
6. **软删除不一致**：导入/重置删除策略不同导致垃圾数据
7. **无优雅关闭**：进程终止时 Prisma 连接泄漏
8. **内存无清理**：长时间运行后内存无限增长

---

## 参考文件

- 架构详情：`ARCHITECTURE.md`
- 安全审计报告：`项目致命问题分析报告.md`
- 后端模块示例：`server/src/modules/tasks/`
- 前端数据层示例：`src/db/index.ts`