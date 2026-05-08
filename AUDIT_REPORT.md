# Table 项目审计报告

生成时间：2026-05-07
扫描范围：全量源码（server/src、src、prisma、配置文件）

---

## 问题总览

| 严重性 | 数量 | 说明 |
|--------|------|------|
| P0 严重 | 5 | 可能导致功能失效或安全风险 |
| P1 中等 | 8 | 影响稳定性、一致性或可维护性 |
| P2 低 | 6 | 代码质量、规范性问题 |
| 信息 | 3 | 改进建议 |

---

## P0 - 严重问题

### P0-1: SyncEngine.performSync() 为空实现

**文件**: `src/sync/SyncEngine.ts` 第 157-177 行

**问题**: `performSync()` 方法是同步引擎的核心，但当前实现完全为空——它直接返回 `{ success: true }`，不执行任何实际同步操作。

```typescript
private async performSync(types: SyncDataType[]): Promise<SyncResult> {
  try {
    if (!types.includes('knowledge')) {
      return { success: true, timestamp: Date.now() };
    }
    return { success: true, timestamp: Date.now() }; // 什么都没做！
  } catch (error) { ... }
}
```

**影响**: 知识库同步功能完全失效，前端调用 `syncNow()` 或 `syncKnowledge()` 会认为同步成功，但实际上没有任何数据被同步。

**修复建议**: 在 `performSync()` 中实现实际的同步逻辑，或删除此方法并给出明确错误提示。

---

### P0-2: 前端 Knowledge API 未检查 response.ok

**文件**: `src/pages/Knowledge/api.ts`

**问题**: 10 个 API 函数中有 8 个未检查 `response.ok`，如果后端返回 4xx/5xx 错误，前端会尝试解析错误响应的 JSON，导致运行时错误。

| 函数 | 行号 | 是否检查 response.ok |
|------|------|---------------------|
| `getNoteList()` | 4-8 | ❌ 未检查 |
| `createNote()` | 10-17 | ❌ 未检查 |
| `getNoteById()` | 19-25 | ⚠️ 仅检查 404 |
| `updateNote()` | 27-37 | ⚠️ 仅检查 404 |
| `deleteNote()` | 39-44 | ⚠️ 仅检查 204 |
| `searchNotes()` | 46-60 | ❌ 未检查 |
| `getAllTags()` | 62-66 | ❌ 未检查 |
| `getPresetTagList()` | 68-72 | ❌ 未检查 |
| `createPresetTag()` | 74-81 | ❌ 未检查 |
| `updatePresetTag()` | 83-93 | ⚠️ 仅检查 404 |
| `deletePresetTag()` | 95-100 | ⚠️ 仅检查 204 |
| `getKnowledgeMetadata()` | 102-105 | ❌ 未检查 |

**影响**: 网络错误、权限错误、500 错误等未被正确处理，可能导致应用崩溃或数据不一致。

**修复建议**: 所有 API 调用都应检查 `response.ok`，或使用统一的 `fetchWithAuth` 错误处理封装。

---

### P0-3: .env.example 缺少关键环境变量

**文件**: `.env.example`

**问题**: `.env.example` 缺少以下在代码中实际使用的环境变量：

| 变量名 | 定义位置 | 用途 |
|---------|----------|------|
| `DEFAULT_USER_ID` | `server/src/shared/config.ts:11` | 默认用户 ID |
| `PROJECTION_OUTBOX_POLL_MS` | `server/src/shared/config.ts:18` | 投影轮询间隔 |
| `PROJECTION_OUTBOX_BATCH_SIZE` | `server/src/shared/config.ts:19` | 投影批处理大小 |

**影响**: 新开发者按 `.env.example` 配置环境时，这些变量会是 undefined，导致使用 Zod 的默认值。如果默认值不适用，会导致运行时错误。

**修复建议**: 在 `.env.example` 中补充这些变量，并添加注释说明用途。

---

### P0-4: PROVIDER_SECRET_KEY 使用不安全的默认值

**文件**: `server/src/shared/config.ts` 第 12 行

**问题**: 
```typescript
PROVIDER_SECRET_KEY: z.string().min(16).default('table-dev-provider-secret-key-change-me'),
```

生产环境中如果管理员忘记设置此变量，将使用这个公开的默认值，导致所有 Provider API Key 使用相同密钥加密，造成严重安全漏洞。

**影响**: 加密的 Provider 密钥可能被破解，导致 API Key 泄露。

**修复建议**: 
1. 移除 `.default()`，强制要求生产环境显式设置
2. 或在启动时检查是否为默认值，如果是则拒绝启动并给出警告

---

### P0-5: DEFAULT_USER_ID 硬编码为公开 UUID

**文件**: `server/src/shared/config.ts` 第 11 行

**问题**: 
```typescript
DEFAULT_USER_ID: z.string().uuid().default('00000000-0000-0000-0000-000000000001'),
```

这个 UUID 是公开的，任何知道此 ID 的人都可以模拟默认用户。

**影响**: 在 `ALLOW_DEFAULT_USER_FALLBACK=true` 时，任何请求都可以模拟此用户。

**修复建议**: 
1. 生产环境设置 `ALLOW_DEFAULT_USER_FALLBACK=false`
2. 文档中明确说明此 UUID 仅用于开发环境

---

## P1 - 中等问题

### P1-1: 数据库索引缺失

**文件**: `prisma/schema.prisma`

**问题**: `Task` 和 `FinanceRecord` 表缺少 `[userId, deletedAt]` 联合索引，而这两个表都使用软删除模式（有 `deletedAt` 字段）。

当前查询模式通常是：`WHERE userId = ? AND deletedAt IS NULL`，没有索引会导致全表扫描。

| 表 | 已有索引 | 建议添加 |
|----|----------|----------|
| `Task` | 无 | `@@index([userId, deletedAt])` |
| `FinanceRecord` | 无 | `@@index([userId, deletedAt])` |
| `KnowledgeNote` | `[userId]`, `[userId, updatedAt]` | - |

**修复建议**: 在 Prisma schema 中为 `Task` 和 `FinanceRecord` 添加联合索引。

---

### P1-2: KnowledgeNote 使用硬删除，与其他模块不一致

**文件**: `prisma/schema.prisma` 第 183-196 行

**问题**: `KnowledgeNote` 模型没有 `deletedAt` 字段，删除时直接从数据库移除记录。而 `Task`、`FinanceRecord`、`ApiProvider` 都使用软删除模式。

**影响**: 
1. 删除的笔记无法恢复
2. 与系统其他部分设计不一致
3. 可能破坏引用完整性

**修复建议**: 为 `KnowledgeNote` 添加 `deletedAt` 字段，统一使用软删除。

---

### P1-3: 空 catch 块吞掉错误

**文件**: `server/src/modules/agent/executor.ts` 第 261-262 行、275-276 行、289-290 行

**问题**: 有三个 catch 块为空实现，仅包含 `// ignore` 注释，错误被完全静默吞掉。

```typescript
// 示例（约 261-262 行）
} catch {
  // ignore
}
```

**影响**: 
1. 运行时错误无法被察觉和修复
2. 调试困难
3. 可能导致未定义行为蔓延

**修复建议**: 
1. 至少记录错误日志：`console.error('Error in ...', error)`
2. 或将错误向上抛出让调用方处理
3. 或明确注释为什么可以安全地忽略此错误

---

### P1-4: API 响应格式不一致

**文件**: 多个后端路由文件

**问题**: 不同模块的 API 响应格式不一致：

| 模块 | 列表返回格式 | 单个返回格式 |
|------|--------------|-------------|
| Tasks | `{ items, total }` (推测) | `task` 对象 |
| Finance | `{ items, total }` (推测) | `record` 对象 |
| Knowledge | `{ items, total, source }` | `note` 对象 或 `{ data, source }` |
| Auth | `{ data: {...} }` | - |
| Providers | `{ data: {...} }` | - |

具体来说，`/api/knowledge/metadata` 返回 `{ data, source }`，而前端 `api.ts` 第 105 行使用 `data.data`，这表明响应格式可能经过了多次包装。

**影响**: 
1. 前端需要针对不同模块写不同的响应解析逻辑
2. 容易引入 bug
3. 增加维护成本

**修复建议**: 统一 API 响应格式，建议使用标准信封格式：
```json
{
  "data": {...},
  "meta": {...},
  "error": null
}
```

---

### P1-5: 乐观锁 version 字段未真正检查

**文件**: `prisma/schema.prisma` 和后端服务层

**问题**: `Task`、`FinanceRecord`、`ApiProvider`、`UserSetting` 都有 `version` 字段，但审计代码未发现后端在服务层真正检查版本冲突的逻辑。

**影响**: 并发更新时可能丢失数据，乐观锁机制名存实亡。

**修复建议**: 在 update 操作中添加 version 检查：
```sql
UPDATE table SET ..., version = version + 1 
WHERE id = ? AND version = ?
-- 如果 affected rows = 0，抛出版本冲突错误
```

---

### P1-6: Knowledge 模块缺少 DTO 层

**文件**: `server/src/modules/knowledge/`

**问题**: 其他模块（tasks、finance、providers、agent）都有独立的 `dto.ts` 文件用于请求/响应数据转换，但 knowledge 模块缺少此层，service 层直接返回 Prisma 模型对象。

**影响**: 
1. 可能意外暴露数据库内部字段
2. 数据库 schema 变更会影响 API 响应
3. 缺少统一的字段映射和类型安全

**修复建议**: 为 knowledge 模块添加 `dto.ts`，参考其他模块的实现。

---

### P1-7: 前端 API 函数返回类型不一致

**文件**: `src/pages/Knowledge/api.ts`

**问题**: 部分函数返回 `Promise<KnowledgeNote>`，部分返回 `Promise<KnowledgeNote | null>`，还有部分返回 `Promise<boolean>`。

| 函数 | 返回类型 | 说明 |
|------|----------|------|
| `getNoteList()` | `Promise<KnowledgeNote[]>` | 不会返回 null |
| `getNoteById()` | `Promise<KnowledgeNote \| null>` | 404 时返回 null |
| `updateNote()` | `Promise<KnowledgeNote \| null>` | 404 时返回 null |
| `deleteNote()` | `Promise<boolean>` | 204 时返回 true |
| `searchNotes()` | `Promise<KnowledgeSearchHit[]>` | 不会返回 null |

**影响**: 调用方需要针对不同的返回类型写不同的处理逻辑，增加复杂度。

**修复建议**: 统一返回类型，或使用统一的 `ApiResponse<T>` 包装类型。

---

### P1-8: loadKnowledgeFromServer 未被 SyncEngine 调用

**文件**: `src/sync/SyncEngine.ts`

**问题**: `SyncEngine` 类定义了 `loadKnowledgeFromServer()` 方法（第 182-225 行），但 `performSync()` 方法是空实现，所以这个方法永远不会被调用。

**影响**: 知识库数据无法从服务器加载到前端，知识库功能完全失效。

**修复建议**: 在 `performSync()` 中调用 `loadKnowledgeFromServer()` 并处理返回的数据。

---

## P2 - 低优先级问题

### P2-1: 重复的日期转换函数

**问题**: `toTimestamp` 和 `toDateOnly` 这类日期转换函数可能在多个文件中重复定义。

**修复建议**: 创建 `src/shared/utils/date.ts` 统一导出这些工具函数。

---

### P2-2: 未使用的依赖

**问题**: 以下依赖在 package.json 中声明，但在代码库中未找到使用痕迹（需进一步验证）：

| 依赖 | 说明 |
|------|------|
| `dexie` | IndexedDB 包装库，项目已迁移到 PostgreSQL |
| `idb` | IndexedDB 辅助库，同上 |
| `@huggingface/transformers` | Transformers.js，用途不明 |
| `react-markdown` | Markdown 渲染，可能被 TipTap 替代 |
| `remark-gfm` | GitHub Flavored Markdown，同上 |
| `fuse.js` | 模糊搜索，可能被后端搜索替代 |
| `use-local-llm` | 本地 LLM 钩子，用途不明 |

**修复建议**: 
1. 确认这些依赖是否确实未使用
2. 如果未使用，从 package.json 中移除
3. 如果已使用但审计时未找到，添加注释说明用途

---

### P2-3: console.log / console.error 残留

**问题**: 代码库中可能存在开发调试时留下的 `console.log` 语句未清除。

**修复建议**: 
1. 使用 ESLint 规则禁止 `console.log`
2. 生产构建时自动移除 console 语句

---

### P2-4: 硬编码的魔法值

**问题**: 以下魔法值在代码中硬编码，建议使用配置文件或常量：

| 值 | 位置 | 建议 |
|----|------|------|
| 端口 `8787` | 多处 | 使用 `SERVER_PORT` 环境变量 |
| 轮询间隔 `1500ms` | config.ts | 已在环境变量中，确保使用 |
| 最大迭代次数 `5` | executor.ts:37 | 定义为常量 `MAX_AGENT_ITERATIONS` |

---

### P2-5: TypeScript 类型断言过度使用

**问题**: 代码中可能存在 `as any` 或 `as unknown as T` 这样的类型断言，绕过类型检查。

**修复建议**: 
1. 使用 ESLint 规则限制类型断言
2. 重构代码，使用正确的类型定义

---

### P2-6: 错误消息硬编码为中文

**问题**: 部分错误消息直接硬编码在代码中（如 `message: 'Note not found'` 实际应为中文？），国际化支持不足。

**修复建议**: 使用统一的错误消息字典，支持 i18n。

---

## 信息级 - 改进建议

### I-1: 添加请求日志中间件

**建议**: 在 Fastify 中添加请求日志中间件，记录所有 API 请求的入参和出参，便于调试和审计。

---

### I-2: 添加 API 集成测试

**建议**: 当前有 `scripts/e2e/` 目录包含端到端测试，但缺少 API 层的单元测试。建议使用 `fastify.inject()` 编写 API 测试。

---

### I-3: 数据库迁移版本管理

**建议**: 当前使用 Prisma Migrate，但建议添加迁移历史记录表，追踪每次迁移的执行时间和结果。

---

## 修复优先级建议

| 优先级 | 问题编号 | 修复工作量 |
|--------|----------|-----------|
| 立即修复 | P0-1, P0-2 | 2-3 天 |
| 本周修复 | P0-3, P0-4, P0-5, P1-1, P1-2, P1-3 | 3-5 天 |
| 下个迭代 | P1-4, P1-5, P1-6, P1-7, P1-8 | 5-8 天 |
|  backlog | P2 系列 | 按需 |

---

## 总结

项目整体架构清晰，已从单机应用成功迁移到前后端分离架构。主要问题集中在：

1. **关键功能缺失**（SyncEngine 为空实现）
2. **错误处理不完善**（前端 API 未检查 response.ok，后端空 catch 块）
3. **配置管理不规范**（.env.example 不完整）
4. **数据库设计不一致**（软删除策略不统一）
5. **代码质量可改进**（未使用的依赖、重复的工具函数）

建议按照优先级逐步修复，重点先解决 P0 级别的问题。
