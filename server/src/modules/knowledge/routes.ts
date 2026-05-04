import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendInfrastructureError } from '../../shared/http';
import {
  createKnowledgeRelationSchema,
  knowledgeDatasetBodySchema,
  knowledgeIdParamSchema,
  knowledgeRelationParamSchema,
  knowledgeSyncPayloadSchema,
  updateKnowledgeDocumentSchema,
  updateKnowledgeEntitySchema,
  updateKnowledgeAssertionSchema,
  upsertKnowledgeAssertionSchema,
  upsertKnowledgeDocumentSchema,
  upsertKnowledgeEntitySchema,
} from './schema';
import {
  createKnowledgeRelationRecord,
  deleteKnowledgeAssertionRecord,
  deleteKnowledgeDocumentRecord,
  deleteKnowledgeEntityRecord,
  deleteKnowledgeRelationRecord,
  getKnowledgeDataset,
  getKnowledgeMetadata,
  listKnowledgeAssertions,
  listKnowledgeDocuments,
  listKnowledgeEntities,
  loadKnowledgeSyncPayload,
  upsertKnowledgeAssertionRecord,
  upsertKnowledgeDocumentRecord,
  upsertKnowledgeEntityRecord,
  replaceKnowledgeAuthorityDataset,
  replaceKnowledgeSyncPayload,
} from './service';

export async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/load-data', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await loadKnowledgeSyncPayload();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/sync-data', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = knowledgeSyncPayloadSchema.parse(request.body);
      const result = await replaceKnowledgeSyncPayload(payload.knowledge);
      return reply.code(200).send(result);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/knowledge/dataset', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dataset = await getKnowledgeDataset();
      return {
        data: dataset,
        source: 'postgres',
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/knowledge/metadata', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metadata = await getKnowledgeMetadata();
      return {
        data: metadata,
        source: 'postgres',
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.put('/knowledge/dataset', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = knowledgeDatasetBodySchema.parse(request.body);
      const dataset = await replaceKnowledgeAuthorityDataset(payload.dataset);
      return {
        data: dataset,
        source: 'postgres',
      };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/knowledge/entities', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const items = await listKnowledgeEntities();
      return { items, total: items.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/knowledge/entities', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = upsertKnowledgeEntitySchema.parse(request.body);
      const item = await upsertKnowledgeEntityRecord(payload);
      return reply.code(201).send(item);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/knowledge/entities/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const payload = updateKnowledgeEntitySchema.parse(request.body);
      const dataset = await getKnowledgeDataset();
      const existing = dataset.entities.find((entity) => entity.id === id);
      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Knowledge entity not found' });
      }

      const item = await upsertKnowledgeEntityRecord({
        id,
        typeId: payload.typeId ?? existing.typeId,
        title: payload.title ?? existing.title,
        summary: payload.summary ?? existing.summary,
        aliases: payload.aliases ?? existing.aliases,
        tags: payload.tags ?? existing.tags,
        attributes: (payload.attributes ?? existing.attributes) as any,
        source: payload.source ?? existing.source,
        confidence: payload.confidence ?? existing.confidence,
      });
      return item;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/knowledge/entities/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const deleted = await deleteKnowledgeEntityRecord(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Knowledge entity not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/knowledge/documents', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const items = await listKnowledgeDocuments();
      return { items, total: items.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/knowledge/documents', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = upsertKnowledgeDocumentSchema.parse(request.body);
      const item = await upsertKnowledgeDocumentRecord(payload);
      return reply.code(201).send(item);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/knowledge/documents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const payload = updateKnowledgeDocumentSchema.parse(request.body);
      const dataset = await getKnowledgeDataset();
      const existing = dataset.documents.find((document) => document.id === id);
      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Knowledge document not found' });
      }

      const item = await upsertKnowledgeDocumentRecord({
        id,
        title: payload.title ?? existing.title,
        summary: payload.summary ?? existing.summary,
        content: payload.content ?? existing.content,
        tags: payload.tags ?? existing.tags,
        entityIds: payload.entityIds ?? existing.entityIds,
        source: payload.source ?? existing.source,
      });
      return item;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/knowledge/documents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const deleted = await deleteKnowledgeDocumentRecord(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Knowledge document not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/knowledge/assertions', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const items = await listKnowledgeAssertions();
      return { items, total: items.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/knowledge/assertions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = upsertKnowledgeAssertionSchema.parse(request.body);
      const item = await upsertKnowledgeAssertionRecord(payload);
      return reply.code(201).send(item);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/knowledge/assertions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const payload = updateKnowledgeAssertionSchema.parse(request.body);
      const dataset = await getKnowledgeDataset();
      const existing = dataset.assertions.find((assertion) => assertion.id === id);
      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Knowledge assertion not found' });
      }

      const item = await upsertKnowledgeAssertionRecord({
        id,
        subjectId: payload.subjectId ?? existing.subjectId,
        predicateId: payload.predicateId ?? existing.predicateId,
        objectId: payload.objectId ?? existing.objectId,
        value: payload.value !== undefined ? payload.value : existing.value,
        evidenceDocumentIds: payload.evidenceDocumentIds ?? existing.evidenceDocumentIds,
        source: payload.source ?? existing.source,
        confidence: payload.confidence ?? existing.confidence,
      });
      return item;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/knowledge/assertions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const deleted = await deleteKnowledgeAssertionRecord(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Knowledge assertion not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/knowledge/relations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = createKnowledgeRelationSchema.parse(request.body);
      const item = await createKnowledgeRelationRecord(payload);
      return reply.code(201).send(item);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/knowledge/relations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = knowledgeRelationParamSchema.parse(request.body);
      const deleted = await deleteKnowledgeRelationRecord(
        payload.subjectId,
        payload.predicateId,
        payload.targetId
      );
      if (!deleted) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Knowledge relation not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });
}
