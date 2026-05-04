import { getKnowledgeDataset, hydrateKnowledgeDataset } from './store';
import { syncEngine } from '../sync';
import {
  KnowledgeAssertion,
  KnowledgeDataset,
  KnowledgeDocument,
  KnowledgeEntity,
} from './types';

interface LoadDataResponse {
  success: boolean;
  data?: {
    knowledge?: unknown;
  };
  error?: string;
}

export async function loadKnowledgeDatasetFromServer(): Promise<KnowledgeDataset> {
  const response = await fetch('/api/load-data');
  if (!response.ok) {
    throw new Error(`Failed to load knowledge data: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as LoadDataResponse;
  return hydrateKnowledgeDataset(payload.data?.knowledge);
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function createUniqueId(prefix: string, label: string, existingIds: Set<string>): string {
  const base = slugify(label) || Date.now().toString(36);
  let candidate = `${prefix}:${base}`;
  let index = 1;

  while (existingIds.has(candidate)) {
    candidate = `${prefix}:${base}-${index}`;
    index += 1;
  }

  return candidate;
}

async function commitKnowledgeDataset(nextDataset: KnowledgeDataset): Promise<KnowledgeDataset> {
  await hydrateKnowledgeDataset(nextDataset);
  const result = await syncEngine.syncNow('knowledge');
  if (!result.success) {
    throw new Error(result.error || 'Failed to sync knowledge data');
  }
  return getKnowledgeDataset();
}

export interface UpsertKnowledgeEntityInput {
  id?: string;
  typeId: string;
  title: string;
  summary?: string;
  aliases?: string[];
  tags?: string[];
  attributes?: KnowledgeEntity['attributes'];
  source?: string;
  confidence?: number;
}

export interface CreateKnowledgeRelationInput {
  subjectId: string;
  predicateId: string;
  targetId: string;
  source?: string;
  confidence?: number;
}

export interface UpsertKnowledgeDocumentInput {
  id?: string;
  title: string;
  summary?: string;
  content?: string;
  tags?: string[];
  entityIds?: string[];
  source?: string;
}

export interface UpsertKnowledgeAssertionInput {
  id?: string;
  subjectId: string;
  predicateId: string;
  objectId?: string;
  value?: KnowledgeAssertion['value'];
  evidenceDocumentIds?: string[];
  source?: string;
  confidence?: number;
}

function markEntityUpdated(entity: KnowledgeEntity, updatedAt: number): KnowledgeEntity {
  return entity.updatedAt === updatedAt ? entity : { ...entity, updatedAt };
}

function markDocumentUpdated(document: KnowledgeDocument, updatedAt: number): KnowledgeDocument {
  return document.updatedAt === updatedAt ? document : { ...document, updatedAt };
}

export async function upsertKnowledgeEntity(
  input: UpsertKnowledgeEntityInput
): Promise<KnowledgeEntity> {
  const currentDataset = getKnowledgeDataset();
  const now = Date.now();
  const existingIds = new Set(currentDataset.entities.map((entity) => entity.id));
  const existingEntity = input.id
    ? currentDataset.entities.find((entity) => entity.id === input.id)
    : undefined;

  const nextEntity: KnowledgeEntity = {
    id: existingEntity?.id || input.id || createUniqueId('entity', input.title, existingIds),
    typeId: input.typeId,
    title: input.title.trim(),
    summary: input.summary?.trim() || '',
    aliases: input.aliases ?? [],
    tags: input.tags ?? [],
    attributes: input.attributes ?? {},
    relations: existingEntity?.relations ?? [],
    source: input.source?.trim() || undefined,
    confidence: input.confidence,
    createdAt: existingEntity?.createdAt ?? now,
    updatedAt: now,
  };

  const nextDataset: KnowledgeDataset = {
    ...currentDataset,
    entities: existingEntity
      ? currentDataset.entities.map((entity) => (entity.id === existingEntity.id ? nextEntity : entity))
      : [nextEntity, ...currentDataset.entities],
    updatedAt: now,
  };

  await commitKnowledgeDataset(nextDataset);
  return nextEntity;
}

export async function upsertKnowledgeDocument(
  input: UpsertKnowledgeDocumentInput
): Promise<KnowledgeDocument> {
  const currentDataset = getKnowledgeDataset();
  const now = Date.now();
  const existingIds = new Set(currentDataset.documents.map((document) => document.id));
  const existingDocument = input.id
    ? currentDataset.documents.find((document) => document.id === input.id)
    : undefined;

  const validEntityIds = new Set(currentDataset.entities.map((entity) => entity.id));
  const nextDocument: KnowledgeDocument = {
    id: existingDocument?.id || input.id || createUniqueId('doc', input.title, existingIds),
    title: input.title.trim(),
    summary: input.summary?.trim() || '',
    content: input.content?.trim() || '',
    tags: Array.from(new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    entityIds: Array.from(
      new Set((input.entityIds ?? []).filter((entityId) => validEntityIds.has(entityId)))
    ),
    source: input.source?.trim() || undefined,
    createdAt: existingDocument?.createdAt ?? now,
    updatedAt: now,
  };

  const nextDataset: KnowledgeDataset = {
    ...currentDataset,
    documents: existingDocument
      ? currentDataset.documents.map((document) =>
          document.id === existingDocument.id ? nextDocument : document
        )
      : [nextDocument, ...currentDataset.documents],
    updatedAt: now,
  };

  await commitKnowledgeDataset(nextDataset);
  return nextDocument;
}

export async function upsertKnowledgeAssertion(
  input: UpsertKnowledgeAssertionInput
): Promise<KnowledgeAssertion> {
  const currentDataset = getKnowledgeDataset();
  const now = Date.now();
  const existingIds = new Set(currentDataset.assertions.map((assertion) => assertion.id));
  const existingAssertion = input.id
    ? currentDataset.assertions.find((assertion) => assertion.id === input.id)
    : undefined;

  const validSubjectIds = new Set(currentDataset.entities.map((entity) => entity.id));
  const validObjectIds = new Set([
    ...currentDataset.entities.map((entity) => entity.id),
    ...currentDataset.documents.map((document) => document.id),
  ]);
  const validEvidenceIds = new Set(currentDataset.documents.map((document) => document.id));

  if (!validSubjectIds.has(input.subjectId)) {
    throw new Error('断言主体必须是已存在的实体。');
  }

  if (input.objectId && !validObjectIds.has(input.objectId)) {
    throw new Error('断言目标不存在。');
  }

  const nextValue =
    input.value === undefined
      ? undefined
      : typeof input.value === 'string'
        ? input.value.trim()
        : input.value;

  if (!input.objectId && (nextValue === undefined || nextValue === '')) {
    throw new Error('断言需要至少提供目标对象或标量值。');
  }

  const nextAssertion: KnowledgeAssertion = {
    id:
      existingAssertion?.id ||
      input.id ||
      createUniqueId(
        'assertion',
        `${input.subjectId}-${input.predicateId}-${input.objectId || String(nextValue)}`,
        existingIds
      ),
    subjectId: input.subjectId,
    predicateId: input.predicateId,
    objectId: input.objectId || undefined,
    value:
      nextValue === undefined || nextValue === ''
        ? undefined
        : nextValue,
    evidenceDocumentIds: Array.from(
      new Set((input.evidenceDocumentIds ?? []).filter((docId) => validEvidenceIds.has(docId)))
    ),
    source: input.source?.trim() || undefined,
    confidence: input.confidence,
    createdAt: existingAssertion?.createdAt ?? now,
    updatedAt: now,
  };

  const nextDataset: KnowledgeDataset = {
    ...currentDataset,
    assertions: existingAssertion
      ? currentDataset.assertions.map((assertion) =>
          assertion.id === existingAssertion.id ? nextAssertion : assertion
        )
      : [nextAssertion, ...currentDataset.assertions],
    updatedAt: now,
  };

  await commitKnowledgeDataset(nextDataset);
  return nextAssertion;
}

export async function deleteKnowledgeRelation(
  subjectId: string,
  predicateId: string,
  targetId: string
): Promise<void> {
  const currentDataset = getKnowledgeDataset();
  const now = Date.now();
  const subjectEntity = currentDataset.entities.find((entity) => entity.id === subjectId);

  if (!subjectEntity) {
    throw new Error('关系起点实体不存在。');
  }

  const nextRelations = subjectEntity.relations.filter(
    (relation) =>
      relation.predicateId !== predicateId || relation.targetId !== targetId
  );

  const nextEntities = currentDataset.entities.map((entity) =>
    entity.id === subjectId
      ? {
          ...entity,
          relations: nextRelations,
          updatedAt: now,
        }
      : entity
  );

  const nextAssertions = currentDataset.assertions.filter(
    (assertion) =>
      !(
        assertion.subjectId === subjectId &&
        assertion.predicateId === predicateId &&
        assertion.objectId === targetId
      )
  );

  const nextDataset: KnowledgeDataset = {
    ...currentDataset,
    entities: nextEntities,
    assertions: nextAssertions,
    updatedAt: now,
  };

  await commitKnowledgeDataset(nextDataset);
}

export async function deleteKnowledgeAssertion(id: string): Promise<void> {
  const currentDataset = getKnowledgeDataset();
  const now = Date.now();
  const targetAssertion = currentDataset.assertions.find((assertion) => assertion.id === id);

  if (!targetAssertion) {
    throw new Error('断言不存在。');
  }

  const nextAssertions = currentDataset.assertions.filter((assertion) => assertion.id !== id);
  const nextEntities = currentDataset.entities.map((entity) => {
    if (
      entity.id !== targetAssertion.subjectId ||
      !targetAssertion.objectId
    ) {
      return entity;
    }

    const nextRelations = entity.relations.filter(
      (relation) =>
        relation.predicateId !== targetAssertion.predicateId ||
        relation.targetId !== targetAssertion.objectId
    );

    if (nextRelations.length === entity.relations.length) {
      return entity;
    }

    return {
      ...entity,
      relations: nextRelations,
      updatedAt: now,
    };
  });

  const nextDataset: KnowledgeDataset = {
    ...currentDataset,
    entities: nextEntities,
    assertions: nextAssertions,
    updatedAt: now,
  };

  await commitKnowledgeDataset(nextDataset);
}

export async function deleteKnowledgeDocument(id: string): Promise<void> {
  const currentDataset = getKnowledgeDataset();
  const now = Date.now();

  if (!currentDataset.documents.some((document) => document.id === id)) {
    throw new Error('文档不存在。');
  }

  const nextDocuments = currentDataset.documents.filter((document) => document.id !== id);
  const nextAssertions = currentDataset.assertions
    .filter((assertion) => assertion.objectId !== id)
    .map((assertion) => {
      if (!assertion.evidenceDocumentIds.includes(id)) {
        return assertion;
      }

      return {
        ...assertion,
        evidenceDocumentIds: assertion.evidenceDocumentIds.filter((docId) => docId !== id),
        updatedAt: now,
      };
    });

  const nextDataset: KnowledgeDataset = {
    ...currentDataset,
    documents: nextDocuments,
    assertions: nextAssertions,
    updatedAt: now,
  };

  await commitKnowledgeDataset(nextDataset);
}

export async function deleteKnowledgeEntity(id: string): Promise<void> {
  const currentDataset = getKnowledgeDataset();
  const now = Date.now();

  if (!currentDataset.entities.some((entity) => entity.id === id)) {
    throw new Error('实体不存在。');
  }

  const nextEntities = currentDataset.entities
    .filter((entity) => entity.id !== id)
    .map((entity) => {
      const nextRelations = entity.relations.filter((relation) => relation.targetId !== id);
      if (nextRelations.length === entity.relations.length) {
        return entity;
      }

      return markEntityUpdated(
        {
          ...entity,
          relations: nextRelations,
        },
        now
      );
    });

  const nextDocuments = currentDataset.documents.map((document) => {
    if (!document.entityIds.includes(id)) {
      return document;
    }

    return markDocumentUpdated(
      {
        ...document,
        entityIds: document.entityIds.filter((entityId) => entityId !== id),
      },
      now
    );
  });

  const nextAssertions = currentDataset.assertions.filter(
    (assertion) => assertion.subjectId !== id && assertion.objectId !== id
  );

  const nextDataset: KnowledgeDataset = {
    ...currentDataset,
    entities: nextEntities,
    documents: nextDocuments,
    assertions: nextAssertions,
    updatedAt: now,
  };

  await commitKnowledgeDataset(nextDataset);
}

export async function createKnowledgeRelation(
  input: CreateKnowledgeRelationInput
): Promise<KnowledgeAssertion> {
  const currentDataset = getKnowledgeDataset();
  const now = Date.now();
  const subjectEntity = currentDataset.entities.find((entity) => entity.id === input.subjectId);
  const targetEntity = currentDataset.entities.find((entity) => entity.id === input.targetId);

  if (!subjectEntity) {
    throw new Error('关系起点实体不存在。');
  }

  if (!targetEntity) {
    throw new Error('关系目标实体不存在。');
  }

  const nextRelation = {
    predicateId: input.predicateId,
    targetId: input.targetId,
    source: input.source?.trim() || undefined,
    confidence: input.confidence,
  };

  const relationExists = subjectEntity.relations.some(
    (relation) =>
      relation.predicateId === nextRelation.predicateId &&
      relation.targetId === nextRelation.targetId
  );

  const nextSubject: KnowledgeEntity = {
    ...subjectEntity,
    relations: relationExists
      ? subjectEntity.relations.map((relation) =>
          relation.predicateId === nextRelation.predicateId &&
          relation.targetId === nextRelation.targetId
            ? nextRelation
            : relation
        )
      : [...subjectEntity.relations, nextRelation],
    updatedAt: now,
  };

  const nextAssertion: KnowledgeAssertion = {
    id: createUniqueId(
      'assertion',
      `${input.subjectId}-${input.predicateId}-${input.targetId}`,
      new Set(currentDataset.assertions.map((assertion) => assertion.id))
    ),
    subjectId: input.subjectId,
    predicateId: input.predicateId,
    objectId: input.targetId,
    evidenceDocumentIds: [],
    source: input.source?.trim() || undefined,
    confidence: input.confidence,
    createdAt: now,
    updatedAt: now,
  };

  const assertionExists = currentDataset.assertions.some(
    (assertion) =>
      assertion.subjectId === input.subjectId &&
      assertion.predicateId === input.predicateId &&
      assertion.objectId === input.targetId
  );

  const nextDataset: KnowledgeDataset = {
    ...currentDataset,
    entities: currentDataset.entities.map((entity) =>
      entity.id === nextSubject.id ? nextSubject : entity
    ),
    assertions: assertionExists
      ? currentDataset.assertions.map((assertion) =>
          assertion.subjectId === input.subjectId &&
          assertion.predicateId === input.predicateId &&
          assertion.objectId === input.targetId
            ? { ...assertion, source: nextAssertion.source, confidence: nextAssertion.confidence, updatedAt: now }
            : assertion
        )
      : [...currentDataset.assertions, nextAssertion],
    updatedAt: now,
  };

  await commitKnowledgeDataset(nextDataset);
  return assertionExists
    ? {
        ...(currentDataset.assertions.find(
          (assertion) =>
            assertion.subjectId === input.subjectId &&
            assertion.predicateId === input.predicateId &&
            assertion.objectId === input.targetId
        ) as KnowledgeAssertion),
        source: nextAssertion.source,
        confidence: nextAssertion.confidence,
        updatedAt: now,
      }
    : nextAssertion;
}
