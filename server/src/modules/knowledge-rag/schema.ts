import { z } from 'zod';

// 文档状态枚举
export const documentStatusEnum = z.enum(['pending', 'processing', 'indexed', 'failed', 'deleted']);
export type DocumentStatus = z.infer<typeof documentStatusEnum>;

// 文件类型枚举
export const fileTypeEnum = z.enum(['pdf', 'md', 'txt', 'markdown']);
export type FileType = z.infer<typeof fileTypeEnum>;

// 保密等级枚举
export const securityLevelEnum = z.enum(['public', 'internal', 'confidential', 'secret']);
export type SecurityLevel = z.infer<typeof securityLevelEnum>;

// 索引任务类型
export const jobTypeEnum = z.enum(['full_index', 'reindex']);
export type JobType = z.infer<typeof jobTypeEnum>;

// 索引任务状态
export const jobStatusEnum = z.enum(['pending', 'running', 'completed', 'failed']);
export type JobStatus = z.infer<typeof jobStatusEnum>;

// 搜索模式
export const searchModeEnum = z.enum(['hybrid', 'semantic', 'keyword']);
export type SearchMode = z.infer<typeof searchModeEnum>;

// 创建文档输入
export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(500),
  summary: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().max(50)).max(20).optional(),
  fileType: fileTypeEnum,
  source: z.string().max(500).optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

// 更新文档输入
export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  summary: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().max(50)).max(20).optional(),
  status: documentStatusEnum.optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

// 辅助函数：将逗号分隔的字符串转换为数组
const commaSeparatedToArray = z.string().transform((val) => val.split(',').map(s => s.trim()).filter(s => s.length > 0));

// 文档查询参数
export const listDocumentsQuerySchema = z.object({
  status: documentStatusEnum.optional(),
  fileType: fileTypeEnum.optional(),
  tags: commaSeparatedToArray.pipe(z.array(z.string().max(50)).max(10)).optional(),
  // === 元数据过滤 ===
  publishDateStart: z.string().optional(),
  publishDateEnd: z.string().optional(),
  sourceDept: commaSeparatedToArray.pipe(z.array(z.string().max(50)).max(10)).optional(),
  securityLevel: securityLevelEnum.optional(),
  businessCategory: commaSeparatedToArray.pipe(z.array(z.string().max(50)).max(10)).optional(),
  // === 分页 ===
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).transform((data) => ({
  ...data,
  publishDateRange: data.publishDateStart || data.publishDateEnd
    ? { start: data.publishDateStart, end: data.publishDateEnd }
    : undefined,
}));
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

// 搜索请求
export const hybridSearchSchema = z.object({
  query: z.string().trim().max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  documentIds: z.array(z.string().uuid()).max(20).optional(),
  mode: searchModeEnum.default('hybrid'),
  limit: z.coerce.number().int().positive().max(50).default(10),
  threshold: z.coerce.number().min(0).max(1).default(0.2),
  fusionWeight: z.coerce.number().min(0).max(1).default(0.7),
  // 新增：Cross-Encoder Rerank
  enableRerank: z.boolean().default(false),
  rerankerThreshold: z.coerce.number().min(0).max(1).optional(),
  // 新增：BM25 全文检索
  useBm25: z.boolean().default(false),
  // 新增：Query 预处理
  enableQueryPreprocess: z.boolean().default(false),
  enableExpansion: z.boolean().default(false),
  enableRewrite: z.boolean().default(true),
  // 新增：MMR 多样性后处理
  enableMmr: z.boolean().default(false),
  mmrLambda: z.coerce.number().min(0).max(1).optional(),
  // === 元数据过滤 ===
  publishDateRange: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
  }).optional(),
  sourceDept: z.array(z.string().max(50)).max(10).optional(),
  securityLevel: securityLevelEnum.optional(),
  businessCategory: z.array(z.string().max(50)).max(10).optional(),
});
export type HybridSearchInput = z.infer<typeof hybridSearchSchema>;

// 分块查询参数
export const listChunksQuerySchema = z.object({
  documentId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListChunksQuery = z.infer<typeof listChunksQuerySchema>;

// 索引任务查询
export const listJobsQuerySchema = z.object({
  status: jobStatusEnum.optional(),
  documentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

// 触发索引请求
export const triggerIndexSchema = z.object({
  force: z.boolean().default(false),
});
export type TriggerIndexInput = z.infer<typeof triggerIndexSchema>;