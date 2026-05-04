const SERVER_ORIGIN = process.env.KNOWLEDGE_API_ORIGIN || 'http://127.0.0.1:8787';

async function request(path, init = {}) {
  const headers = {
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
  const payload = await request('/api/load-data');
  const knowledge = payload?.data?.knowledge;

  if (!knowledge || typeof knowledge !== 'object') {
    throw new Error('/api/load-data 未返回 knowledge 数据集。');
  }

  return knowledge;
}

function countDataset(knowledge) {
  return {
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

async function cleanup(created, ids) {
  const jobs = [];

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
  };
  const created = {
    entity: false,
    document: false,
    assertion: false,
    relation: false,
  };

  const baseline = await loadKnowledge();
  const baselineCounts = countDataset(baseline);

  try {
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

    const hasAssertion = Array.isArray(afterCreate.assertions)
      ? afterCreate.assertions.some(
          (assertion) =>
            assertion.id === ids.assertionId &&
            assertion.subjectId === ids.entityId &&
            assertion.objectId === ids.documentId
        )
      : false;

    if (!hasAssertion) {
      throw new Error('知识断言已写入，但未在数据集中找到。');
    }

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

    if (
      afterDeleteCounts.entityCount !== baselineCounts.entityCount ||
      afterDeleteCounts.documentCount !== baselineCounts.documentCount ||
      afterDeleteCounts.assertionCount !== baselineCounts.assertionCount
    ) {
      throw new Error(
        `删除后计数未恢复基线: baseline=${JSON.stringify(baselineCounts)} current=${JSON.stringify(afterDeleteCounts)}`
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          baselineCounts,
          afterCreateCounts,
          afterDeleteCounts,
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
