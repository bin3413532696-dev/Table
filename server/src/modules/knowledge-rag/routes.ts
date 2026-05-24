import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import { getCurrentUserId } from '../../shared/user-context';
import { sendInfrastructureError } from '../../shared/http';
import {
  getDocuments,
  getDocument,
  uploadDocument,
  updateDocumentService,
  deleteDocumentService,
  triggerIndex,
  getJobs,
  getJob,
  getStats,
  getChunks,
  backfillEmbeddings,
  search,
  searchWithContext,
  initializeJobRecovery,
} from './service';
import {
  searchSuggestions,
} from './retrieval/hybrid-search';
import {
  listDocumentsQuerySchema,
  hybridSearchSchema,
  listChunksQuerySchema,
  listJobsQuerySchema,
  triggerIndexSchema,
  updateDocumentSchema,
} from './schema';

// 注册 multipart 插件
export async function registerMultipart(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
      files: 1,
    },
  });
}

// 路由注册
export async function knowledgeRagRoutes(app: FastifyInstance) {
  // 注册 multipart 插件（用于文件上传）
  await registerMultipart(app);

  // =====================================================
  // 文档管理
  // =====================================================

  // 上传文档
  app.post('/knowledge-rag/documents/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getCurrentUserId();
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ error: '未提供文件' });
      }

      // 从 fields 提取额外参数
      const title = (data.fields as any)?.title?.value;
      const tagsStr = (data.fields as any)?.tags?.value;

      // 安全解析 tags JSON
      let tags: string[] = [];
      if (tagsStr) {
        try {
          const parsed = JSON.parse(tagsStr);
          if (Array.isArray(parsed)) {
            tags = parsed.filter((item): item is string => typeof item === 'string');
          }
        } catch {
          // 解析失败时忽略，使用空数组
        }
      }

      const result = await uploadDocument(userId, data, title, tags);
      return reply.status(201).send(result);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 文档列表
  app.get('/knowledge-rag/documents', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = listDocumentsQuerySchema.parse(request.query);
      const result = await getDocuments(query);
      return result; // { items, total }
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 文档详情
  app.get('/knowledge-rag/documents/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const result = await getDocument(id);

      if (!result) {
        return reply.status(404).send({ error: '文档不存在' });
      }

      return result;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 更新文档
  app.patch('/knowledge-rag/documents/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const input = updateDocumentSchema.parse(request.body);
      const result = await updateDocumentService(id, input);

      if (!result) {
        return reply.status(404).send({ error: '文档不存在' });
      }

      return result;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 删除文档
  app.delete('/knowledge-rag/documents/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const success = await deleteDocumentService(id);

      if (!success) {
        return reply.status(404).send({ error: '文档不存在' });
      }

      return { deleted: true };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // =====================================================
  // 索引管理
  // =====================================================

  // 触发索引
  app.post('/knowledge-rag/documents/:id/index', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const input = triggerIndexSchema.parse(request.body ?? {});
      const result = await triggerIndex(id, input);
      return result;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 补充 Embedding
  app.post('/knowledge-rag/documents/:id/backfill', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const result = await backfillEmbeddings(id);
      return result;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 索引任务列表
  app.get('/knowledge-rag/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = listJobsQuerySchema.parse(request.query);
      const result = await getJobs(query);
      return result; // { items, total }
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 索引任务详情
  app.get('/knowledge-rag/jobs/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const result = await getJob(id);

      if (!result) {
        return reply.status(404).send({ error: '任务不存在' });
      }

      return result;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // =====================================================
  // 分块管理
  // =====================================================

  // 分块列表
  app.get('/knowledge-rag/chunks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = listChunksQuerySchema.parse(request.query);
      const result = await getChunks(query);
      return result; // { items, total }
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // =====================================================
  // 搜索
  // =====================================================

  // 搜索建议
  app.get('/knowledge-rag/suggestions', async (request: FastifyRequest<{ Querystring: { query: string; limit?: string } }>, reply: FastifyReply) => {
    try {
      const { query, limit } = request.query as any;
      const result = await searchSuggestions(query || '', limit ? parseInt(limit) : 5);
      return { suggestions: result };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 混合搜索
  app.post('/knowledge-rag/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = hybridSearchSchema.parse(request.body);
      const result = await search(input);
      return result;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 搜索（带上下文）
  app.post('/knowledge-rag/search/context', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = hybridSearchSchema.parse(request.body);
      const result = await searchWithContext(input);
      return result;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // =====================================================
  // 统计
  // =====================================================

  // RAG 统计
  app.get('/knowledge-rag/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await getStats();
      return result;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 服务启动时初始化 Job 恢复机制
  initializeJobRecovery().catch(console.error);
}