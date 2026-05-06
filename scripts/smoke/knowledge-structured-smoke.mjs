const SERVER_ORIGIN = process.env.KNOWLEDGE_API_ORIGIN || 'http://127.0.0.1:8787';
const DEFAULT_USER_ID = process.env.KNOWLEDGE_USER_ID || '00000000-0000-0000-0000-000000000001';

async function request(path, init = {}) {
  const headers = {
    'x-user-id': DEFAULT_USER_ID,
    ...(init.headers || {}),
  };

  if (init.body !== undefined && !('Content-Type' in headers)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${SERVER_ORIGIN}${path}`, {
    headers,
    ...init,
  });

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? payload.message
        : `HTTP ${response.status}`;
    throw new Error(`${init.method || 'GET'} ${path} failed: ${message}`);
  }

  return payload;
}

async function loadKnowledge() {
  const payload = await request('/api/knowledge/dataset');
  const knowledge = payload?.data;

  if (!knowledge || typeof knowledge !== 'object') {
    throw new Error('/api/knowledge/dataset 未返回 knowledge 数据集。');
  }

  return knowledge;
}

function countDataset(knowledge) {
  return {
    classCount: Array.isArray(knowledge.ontology?.classes) ? knowledge.ontology.classes.length : 0,
    relationTypeCount: Array.isArray(knowledge.ontology?.relations) ? knowledge.ontology.relations.length : 0,
    entityCount: Array.isArray(knowledge.entities) ? knowledge.entities.length : 0,
    documentCount: Array.isArray(knowledge.documents) ? knowledge.documents.length : 0,
    assertionCount: Array.isArray(knowledge.assertions) ? knowledge.assertions.length : 0,
  };
}

function requireEntity(knowledge, entityId) {
  const entity = Array.isArray(knowledge.entities)
    ? knowledge.entities.find((item) => item.id === entityId)
    : undefined;

  if (!entity) {
    throw new Error(`未找到知识实体: ${entityId}`);
  }

  return entity;
}

function hasEntity(knowledge, entityId) {
  return Array.isArray(knowledge.entities)
    ? knowledge.entities.some((item) => item.id === entityId)
    : false;
}

function hasDocument(knowledge, documentId) {
  return Array.isArray(knowledge.documents)
    ? knowledge.documents.some((item) => item.id === documentId)
    : false;
}

function hasAssertion(knowledge, assertionId) {
  return Array.isArray(knowledge.assertions)
    ? knowledge.assertions.some((item) => item.id === assertionId)
    : false;
}

async function cleanup(created, ids) {
  const jobs = [];

  if (created.ontologyRelationA) {
    jobs.push(
      request(`/api/knowledge/ontology/relations/${encodeURIComponent(ids.ontologyRelationAId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          inverseId: null,
        }),
      }).catch(() => undefined)
    );
  }

  if (created.ontologyRelationA) {
    jobs.push(
      request(`/api/knowledge/ontology/relations/${encodeURIComponent(ids.ontologyRelationAId)}`, {
        method: 'DELETE',
      }).catch(() => undefined)
    );
  }

  if (created.ontologyRelationB) {
    jobs.push(
      request(`/api/knowledge/ontology/relations/${encodeURIComponent(ids.ontologyRelationBId)}`, {
        method: 'DELETE',
      }).catch(() => undefined)
    );
  }

  if (created.ontologyChildClass) {
    jobs.push(
      request(`/api/knowledge/ontology/classes/${encodeURIComponent(ids.ontologyChildClassId)}`, {
        method: 'DELETE',
      }).catch(() => undefined)
    );
  }

  if (created.ontologyParentClass) {
    jobs.push(
      request(`/api/knowledge/ontology/classes/${encodeURIComponent(ids.ontologyParentClassId)}`, {
        method: 'DELETE',
      }).catch(() => undefined)
    );
  }

  if (created.relation) {
    jobs.push(
      request('/api/knowledge/relations', {
        method: 'DELETE',
        body: JSON.stringify({
          subjectId: 'entity:workspace',
          predicateId: 'relation:dependsOn',
          targetId: ids.entityId,
        }),
      }).catch(() => undefined)
    );
  }

  if (created.assertion) {
    jobs.push(
      request(`/api/knowledge/assertions/${encodeURIComponent(ids.assertionId)}`, {
        method: 'DELETE',
      }).catch(() => undefined)
    );
  }

  if (created.document) {
    jobs.push(
      request(`/api/knowledge/documents/${encodeURIComponent(ids.documentId)}`, {
        method: 'DELETE',
      }).catch(() => undefined)
    );
  }

  if (created.entity) {
    jobs.push(
      request(`/api/knowledge/entities/${encodeURIComponent(ids.entityId)}`, {
        method: 'DELETE',
      }).catch(() => undefined)
    );
  }

  await Promise.all(jobs);
}

async function main() {
  const suffix = Date.now().toString(36);
  const ids = {
    entityId: `entity:smoke-${suffix}`,
    documentId: `doc:smoke-${suffix}`,
    assertionId: `assertion:smoke-${suffix}`,
    relationSource: `knowledge-smoke-relation-${suffix}`,
    ontologyParentClassId: `class:smoke-parent-${suffix}`,
    ontologyChildClassId: `class:smoke-child-${suffix}`,
    ontologyRelationAId: `rel:smoke-a-${suffix}`,
    ontologyRelationBId: `rel:smoke-b-${suffix}`,
  };
  const created = {
    ontologyParentClass: false,
    ontologyChildClass: false,
    ontologyRelationA: false,
    ontologyRelationB: false,
    entity: false,
    document: false,
    assertion: false,
    relation: false,
  };

  const baseline = await loadKnowledge();
  const baselineCounts = countDataset(baseline);

  try {
    await request('/api/knowledge/ontology/classes', {
      method: 'POST',
      body: JSON.stringify({
        id: ids.ontologyParentClassId,
        label: `Smoke Parent ${suffix}`,
        description: 'knowledge smoke ontology parent class',
      }),
    });
    created.ontologyParentClass = true;

    await request('/api/knowledge/ontology/classes', {
      method: 'POST',
      body: JSON.stringify({
        id: ids.ontologyChildClassId,
        label: `Smoke Child ${suffix}`,
        description: 'knowledge smoke ontology child class',
        parentIds: [ids.ontologyParentClassId],
      }),
    });
    created.ontologyChildClass = true;

    await request(`/api/knowledge/ontology/classes/${encodeURIComponent(ids.ontologyChildClassId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        label: `Smoke Child Updated ${suffix}`,
        description: 'knowledge smoke ontology child class updated',
        parentIds: [ids.ontologyParentClassId],
      }),
    });

    const classList = await request('/api/knowledge/ontology/classes');
    const createdChildClass = Array.isArray(classList?.items)
      ? classList.items.find((item) => item.id === ids.ontologyChildClassId)
      : undefined;

    if (
      !createdChildClass ||
      createdChildClass.label !== `Smoke Child Updated ${suffix}` ||
      !Array.isArray(createdChildClass.parentIds) ||
      !createdChildClass.parentIds.includes(ids.ontologyParentClassId)
    ) {
      throw new Error('Ontology class CRUD 验证失败。');
    }

    await request('/api/knowledge/ontology/relations', {
      method: 'POST',
      body: JSON.stringify({
        id: ids.ontologyRelationAId,
        label: `Smoke Relation A ${suffix}`,
        description: 'knowledge smoke ontology relation A',
      }),
    });
    created.ontologyRelationA = true;

    await request('/api/knowledge/ontology/relations', {
      method: 'POST',
      body: JSON.stringify({
        id: ids.ontologyRelationBId,
        label: `Smoke Relation B ${suffix}`,
        description: 'knowledge smoke ontology relation B',
      }),
    });
    created.ontologyRelationB = true;

    await request(`/api/knowledge/ontology/relations/${encodeURIComponent(ids.ontologyRelationAId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        label: `Smoke Relation A Updated ${suffix}`,
        description: 'knowledge smoke ontology relation A updated',
        inverseId: ids.ontologyRelationBId,
        symmetric: true,
        transitive: false,
      }),
    });

    const relationList = await request('/api/knowledge/ontology/relations');
    const createdRelationA = Array.isArray(relationList?.items)
      ? relationList.items.find((item) => item.id === ids.ontologyRelationAId)
      : undefined;

    if (
      !createdRelationA ||
      createdRelationA.label !== `Smoke Relation A Updated ${suffix}` ||
      createdRelationA.inverseId !== ids.ontologyRelationBId ||
      createdRelationA.symmetric !== true
    ) {
      throw new Error('Ontology relation CRUD 验证失败。');
    }

    const rebuildResult = await request('/api/knowledge/rebuild/projections', {
      method: 'POST',
    });

    if (
      !rebuildResult?.data ||
      !Number.isInteger(rebuildResult.data.queuedTaskProjections) ||
      !Number.isInteger(rebuildResult.data.queuedFinanceProjections) ||
      typeof rebuildResult.data.queuedAt !== 'string'
    ) {
      throw new Error('知识投影重建接口返回结构不符合预期。');
    }

    await request('/api/knowledge/entities', {
      method: 'POST',
      body: JSON.stringify({
        id: ids.entityId,
        typeId: 'class:concept',
        title: `结构化存储冒烟实体 ${suffix}`,
        summary: '用于验证 knowledge 结构化存储 CRUD 链路。',
        aliases: ['knowledge smoke entity'],
        tags: ['smoke', 'knowledge'],
        attributes: {
          stage: 'smoke',
          source: 'knowledge:smoke',
        },
        source: 'knowledge:smoke',
        confidence: 0.95,
      }),
    });
    created.entity = true;

    await request('/api/knowledge/documents', {
      method: 'POST',
      body: JSON.stringify({
        id: ids.documentId,
        title: `结构化存储冒烟文档 ${suffix}`,
        summary: '结构化存储联调文档',
        content: 'This document is created by the structured knowledge smoke test.',
        tags: ['smoke', 'knowledge', 'document'],
        entityIds: [ids.entityId],
        source: 'knowledge:smoke',
      }),
    });
    created.document = true;

    await request('/api/knowledge/assertions', {
      method: 'POST',
      body: JSON.stringify({
        id: ids.assertionId,
        subjectId: ids.entityId,
        predicateId: 'relation:relatedTo',
        objectId: ids.documentId,
        evidenceDocumentIds: [ids.documentId],
        source: 'knowledge:smoke',
        confidence: 0.9,
      }),
    });
    created.assertion = true;

    const searchByEntityTitle = await request(
      `/api/knowledge/search?query=${encodeURIComponent(`冒烟实体 ${suffix}`)}&limit=10`
    );

    const searchEntityHit = Array.isArray(searchByEntityTitle?.items)
      ? searchByEntityTitle.items.find((item) => item.kind === 'entity' && item.id === ids.entityId)
      : undefined;

    if (!searchEntityHit || typeof searchEntityHit.score !== 'number' || searchEntityHit.score <= 0) {
      throw new Error('知识搜索未返回预期的实体命中结果。');
    }

    const searchByDocumentText = await request(
      `/api/knowledge/search?query=${encodeURIComponent('structured knowledge smoke test')}&limit=10`
    );

    const searchDocumentHit = Array.isArray(searchByDocumentText?.items)
      ? searchByDocumentText.items.find((item) => item.kind === 'document' && item.id === ids.documentId)
      : undefined;

    if (!searchDocumentHit || typeof searchDocumentHit.score !== 'number' || searchDocumentHit.score <= 0) {
      throw new Error('知识搜索未返回预期的文档命中结果。');
    }

    const searchByTagEntityOnly = await request(
      `/api/knowledge/search?tags=${encodeURIComponent('document')}&includeDocuments=false&limit=10`
    );

    if (
      Array.isArray(searchByTagEntityOnly?.items) &&
      searchByTagEntityOnly.items.some((item) => item.kind === 'document')
    ) {
      throw new Error('知识搜索在 includeDocuments=false 时仍返回了文档结果。');
    }

    const searchByTagDocument = await request(
      `/api/knowledge/search?tags=${encodeURIComponent('document')}&includeDocuments=true&limit=10`
    );

    const searchDocumentTagHit = Array.isArray(searchByTagDocument?.items)
      ? searchByTagDocument.items.find((item) => item.kind === 'document' && item.id === ids.documentId)
      : undefined;

    if (!searchDocumentTagHit) {
      throw new Error('知识搜索未返回预期的 tags 过滤文档结果。');
    }

    const unifiedSearch = await request(
      `/api/search?query=${encodeURIComponent(`冒烟实体 ${suffix}`)}&modules=knowledge&limit=10`
    );

    const unifiedKnowledgeHit = Array.isArray(unifiedSearch?.items)
      ? unifiedSearch.items.find(
          (item) => item.module === 'knowledge' && item.kind === 'entity' && item.id === ids.entityId
        )
      : undefined;

    if (!unifiedKnowledgeHit) {
      throw new Error('统一搜索未返回预期的 knowledge 实体命中结果。');
    }

    const relationAssertion = await request('/api/knowledge/relations', {
      method: 'POST',
      body: JSON.stringify({
        subjectId: 'entity:workspace',
        predicateId: 'relation:dependsOn',
        targetId: ids.entityId,
        source: ids.relationSource,
        confidence: 0.85,
      }),
    });
    created.relation = true;

    const afterCreate = await loadKnowledge();
    const afterCreateCounts = countDataset(afterCreate);
    const workspaceEntity = requireEntity(afterCreate, 'entity:workspace');
    requireEntity(afterCreate, ids.entityId);

    const hasWorkspaceRelation = Array.isArray(workspaceEntity.relations)
      ? workspaceEntity.relations.some(
          (relation) =>
            relation.predicateId === 'relation:dependsOn' &&
            relation.targetId === ids.entityId &&
            relation.source === ids.relationSource
        )
      : false;

    if (!hasWorkspaceRelation) {
      throw new Error('知识关系已写入，但未在实体 relations 投影中找到。');
    }

    const hasDocumentLink = Array.isArray(afterCreate.documents)
      ? afterCreate.documents.some(
          (document) =>
            document.id === ids.documentId &&
            Array.isArray(document.entityIds) &&
            document.entityIds.includes(ids.entityId)
        )
      : false;

    if (!hasDocumentLink) {
      throw new Error('知识文档已写入，但未建立 document-entity 链接。');
    }

    const hasCreatedAssertion = Array.isArray(afterCreate.assertions)
      ? afterCreate.assertions.some(
          (assertion) =>
            assertion.id === ids.assertionId &&
            assertion.subjectId === ids.entityId &&
            assertion.objectId === ids.documentId
        )
      : false;

    if (!hasCreatedAssertion) {
      throw new Error('知识断言已写入，但未在数据集中找到。');
    }

    await request(`/api/knowledge/ontology/relations/${encodeURIComponent(ids.ontologyRelationAId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        inverseId: null,
      }),
    });

    await request('/api/knowledge/relations', {
      method: 'DELETE',
      body: JSON.stringify({
        subjectId: 'entity:workspace',
        predicateId: 'relation:dependsOn',
        targetId: ids.entityId,
      }),
    });
    created.relation = false;

    await request(`/api/knowledge/assertions/${encodeURIComponent(ids.assertionId)}`, {
      method: 'DELETE',
    });
    created.assertion = false;

    await request(`/api/knowledge/documents/${encodeURIComponent(ids.documentId)}`, {
      method: 'DELETE',
    });
    created.document = false;

    await request(`/api/knowledge/entities/${encodeURIComponent(ids.entityId)}`, {
      method: 'DELETE',
    });
    created.entity = false;

    await request(`/api/knowledge/ontology/relations/${encodeURIComponent(ids.ontologyRelationAId)}`, {
      method: 'DELETE',
    });
    created.ontologyRelationA = false;

    await request(`/api/knowledge/ontology/relations/${encodeURIComponent(ids.ontologyRelationBId)}`, {
      method: 'DELETE',
    });
    created.ontologyRelationB = false;

    await request(`/api/knowledge/ontology/classes/${encodeURIComponent(ids.ontologyChildClassId)}`, {
      method: 'DELETE',
    });
    created.ontologyChildClass = false;

    await request(`/api/knowledge/ontology/classes/${encodeURIComponent(ids.ontologyParentClassId)}`, {
      method: 'DELETE',
    });
    created.ontologyParentClass = false;

    const afterDelete = await loadKnowledge();
    const afterDeleteCounts = countDataset(afterDelete);
    const workspaceAfterDelete = requireEntity(afterDelete, 'entity:workspace');
    const relationStillExists = Array.isArray(workspaceAfterDelete.relations)
      ? workspaceAfterDelete.relations.some(
          (relation) =>
            relation.predicateId === 'relation:dependsOn' && relation.targetId === ids.entityId
        )
      : false;

    if (relationStillExists) {
      throw new Error('知识关系删除后仍然残留在实体投影中。');
    }

    const ontologyClassStillExists = Array.isArray(afterDelete.ontology?.classes)
      ? afterDelete.ontology.classes.some(
          (item) => item.id === ids.ontologyParentClassId || item.id === ids.ontologyChildClassId
        )
      : false;

    if (ontologyClassStillExists) {
      throw new Error('Ontology class 删除后仍然残留在数据集中。');
    }

    const ontologyRelationStillExists = Array.isArray(afterDelete.ontology?.relations)
      ? afterDelete.ontology.relations.some(
          (item) => item.id === ids.ontologyRelationAId || item.id === ids.ontologyRelationBId
        )
      : false;

    if (ontologyRelationStillExists) {
      throw new Error('Ontology relation 删除后仍然残留在数据集中。');
    }

    if (
      hasEntity(afterDelete, ids.entityId) ||
      hasDocument(afterDelete, ids.documentId) ||
      hasAssertion(afterDelete, ids.assertionId)
    ) {
      throw new Error('本次 smoke 创建的 knowledge 数据未被完全清理。');
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          baselineCounts,
          afterCreateCounts,
          afterDeleteCounts,
          rebuildProjectionSummary: rebuildResult.data,
          mirroredRelationAssertionId: relationAssertion?.id || null,
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(created, ids);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
