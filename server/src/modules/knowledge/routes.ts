import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendInfrastructureError } from '../../shared/http';
import {
  noteIdParamSchema,
  presetTagIdParamSchema,
  createNoteSchema,
  updateNoteSchema,
  noteSearchQuerySchema,
  createPresetTagSchema,
  updatePresetTagSchema,
} from './schema';
import {
  getNoteList,
  createNoteRecord,
  getNoteDetail,
  updateNoteRecord,
  deleteNoteRecord,
  searchNoteRecords,
  getAllTags,
  getPresetTagList,
  createPresetTagRecord,
  getPresetTagDetail,
  updatePresetTagRecord,
  deletePresetTagRecord,
  getKnowledgeOverview,
} from './service';

export async function knowledgeRoutes(app: FastifyInstance) {
  // 笔记列表
  app.get('/knowledge/notes', async (_request, reply) => {
    try {
      const items = await getNoteList();
      return { items, total: items.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 创建笔记
  app.post('/knowledge/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = createNoteSchema.parse(request.body);
      const note = await createNoteRecord(payload);
      return reply.code(201).send(note);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 获取单个笔记
  app.get('/knowledge/notes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = noteIdParamSchema.parse(request.params);
      const note = await getNoteDetail(id);
      if (!note) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
      }
      return note;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 更新笔记
  app.patch('/knowledge/notes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = noteIdParamSchema.parse(request.params);
      const payload = updateNoteSchema.parse(request.body);
      const note = await updateNoteRecord(id, payload);
      if (!note) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
      }
      return note;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 删除笔记
  app.delete('/knowledge/notes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = noteIdParamSchema.parse(request.params);
      const deleted = await deleteNoteRecord(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 搜索笔记
  app.get('/knowledge/search', async (request: FastifyRequest, reply) => {
    try {
      const query = noteSearchQuerySchema.parse(request.query);
      const items = await searchNoteRecords(query);
      return { items, total: items.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 获取所有使用过的标签
  app.get('/knowledge/tags', async (_request, reply) => {
    try {
      const tags = await getAllTags();
      return { items: tags, total: tags.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 获取预设标签列表
  app.get('/knowledge/tags/preset', async (_request, reply) => {
    try {
      const items = await getPresetTagList();
      return { items, total: items.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 创建预设标签
  app.post('/knowledge/tags/preset', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = createPresetTagSchema.parse(request.body);
      const tag = await createPresetTagRecord(payload);
      return reply.code(201).send(tag);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 获取单个预设标签
  app.get('/knowledge/tags/preset/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = presetTagIdParamSchema.parse(request.params);
      const tag = await getPresetTagDetail(id);
      if (!tag) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Preset tag not found' });
      }
      return tag;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 更新预设标签
  app.patch('/knowledge/tags/preset/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = presetTagIdParamSchema.parse(request.params);
      const payload = updatePresetTagSchema.parse(request.body);
      const tag = await updatePresetTagRecord(id, payload);
      if (!tag) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Preset tag not found' });
      }
      return tag;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 删除预设标签
  app.delete('/knowledge/tags/preset/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = presetTagIdParamSchema.parse(request.params);
      const deleted = await deletePresetTagRecord(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Preset tag not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  // 获取知识库概览
  app.get('/knowledge/metadata', async (_request, reply) => {
    try {
      const data = await getKnowledgeOverview();
      return { data, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}