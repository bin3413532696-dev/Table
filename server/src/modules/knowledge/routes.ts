import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendInfrastructureError } from '../../shared/http';
import { kickProjectionRuntime } from '../projection/runtime';
import {
  createKnowledgeRelationSchema,
  knowledgeDatasetBodySchema,
  knowledgeIdParamSchema,
  knowledgeRelationParamSchema,
  knowledgeSearchQuerySchema,
  updateOntologyClassSchema,
  updateOntologyRelationSchema,
  updateKnowledgeDocumentSchema,
  updateKnowledgeEntitySchema,
  updateKnowledgeAssertionSchema,
  upsertOntologyClassSchema,
  upsertOntologyRelationSchema,
  upsertKnowledgeAssertionSchema,
  upsertKnowledgeDocumentSchema,
  upsertKnowledgeEntitySchema,
} from './schema';
import {
  createKnowledgeRelationRecord,
  deleteKnowledgeOntologyClass,
  deleteKnowledgeOntologyRelation,
  deleteKnowledgeAssertionRecord,
  deleteKnowledgeDocumentRecord,
  deleteKnowledgeEntityRecord,
  deleteKnowledgeRelationRecord,
  getKnowledgeDataset,
  getKnowledgeMetadata,
  listKnowledgeOntologyClasses,
  listKnowledgeOntologyRelations,
  listKnowledgeAssertions,
  listKnowledgeDocuments,
  listKnowledgeEntities,
  rebuildKnowledgeProjectionRecords,
  searchKnowledge,
  upsertKnowledgeOntologyClass,
  upsertKnowledgeOntologyRelation,
  upsertKnowledgeAssertionRecord,
  upsertKnowledgeDocumentRecord,
  upsertKnowledgeEntityRecord,
  replaceKnowledgeAuthorityDataset,
} from './service';

export async function knowledgeRoutes(app: FastifyInstance) {
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

  app.get('/knowledge/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = knowledgeSearchQuerySchema.parse(request.query);
      const items = await searchKnowledge(query);
      return {
        items,
        total: items.length,
        source: 'postgres',
      };
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

  app.get('/knowledge/ontology/classes', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const items = await listKnowledgeOntologyClasses();
      return { items, total: items.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/knowledge/ontology/classes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = upsertOntologyClassSchema.parse(request.body);
      const item = await upsertKnowledgeOntologyClass(payload);
      return reply.code(201).send(item);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/knowledge/ontology/classes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const payload = updateOntologyClassSchema.parse(request.body);
      const classes = await listKnowledgeOntologyClasses();
      const existing = classes.find((item) => item.id === id);
      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ontology class not found' });
      }

      const item = await upsertKnowledgeOntologyClass({
        id,
        label: payload.label ?? existing.label,
        description: payload.description ?? existing.description,
        parentIds: payload.parentIds ?? existing.parentIds,
      });
      return item;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/knowledge/ontology/classes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const deleted = await deleteKnowledgeOntologyClass(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ontology class not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.get('/knowledge/ontology/relations', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const items = await listKnowledgeOntologyRelations();
      return { items, total: items.length, source: 'postgres' };
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/knowledge/ontology/relations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = upsertOntologyRelationSchema.parse(request.body);
      const item = await upsertKnowledgeOntologyRelation(payload);
      return reply.code(201).send(item);
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.patch('/knowledge/ontology/relations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const payload = updateOntologyRelationSchema.parse(request.body);
      const relations = await listKnowledgeOntologyRelations();
      const existing = relations.find((item) => item.id === id);
      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ontology relation not found' });
      }

      const item = await upsertKnowledgeOntologyRelation({
        id,
        label: payload.label ?? existing.label,
        description: payload.description ?? existing.description,
        inverseId: payload.inverseId === null ? undefined : (payload.inverseId ?? existing.inverseId),
        symmetric: payload.symmetric ?? existing.symmetric,
        transitive: payload.transitive ?? existing.transitive,
      });
      return item;
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.delete('/knowledge/ontology/relations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = knowledgeIdParamSchema.parse(request.params);
      const deleted = await deleteKnowledgeOntologyRelation(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Ontology relation not found' });
      }
      return reply.code(204).send();
    } catch (error) {
      return sendInfrastructureError(reply, error);
    }
  });

  app.post('/knowledge/rebuild/projections', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await rebuildKnowledgeProjectionRecords();
      kickProjectionRuntime();
      return reply.code(202).send({
        data: result,
        source: 'postgres',
      });
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
