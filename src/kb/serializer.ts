import {
  JsonLdContext,
  KnowledgeAssertion,
  KnowledgeDataset,
  KnowledgeDocument,
  KnowledgeEntity,
  KnowledgeRelationEdge,
  KnowledgeAttributeValue,
  OntologyClass,
  OntologyRelation,
} from './types';
import { DEFAULT_KNOWLEDGE_DATASET, KNOWLEDGE_CONTEXT } from './schema';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asContext(value: unknown): JsonLdContext {
  if (!isRecord(value)) {
    return KNOWLEDGE_CONTEXT;
  }

  return Object.entries(value).reduce<JsonLdContext>((acc, [key, item]) => {
    if (typeof item === 'string') {
      acc[key] = item;
    } else if (
      isRecord(item) &&
      typeof item['@id'] === 'string' &&
      (item['@type'] === undefined || typeof item['@type'] === 'string') &&
      (item['@container'] === undefined || typeof item['@container'] === 'string')
    ) {
      acc[key] = {
        '@id': item['@id'],
        ...(typeof item['@type'] === 'string' ? { '@type': item['@type'] } : {}),
        ...(typeof item['@container'] === 'string' ? { '@container': item['@container'] } : {}),
      };
    }
    return acc;
  }, {});
}

function asAttributes(value: unknown): Record<string, KnowledgeAttributeValue> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, KnowledgeAttributeValue>>((acc, [key, item]) => {
    if (
      item === null ||
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    ) {
      acc[key] = item;
      return acc;
    }

    if (Array.isArray(item)) {
      const normalized = item.filter((entry) =>
        entry === null ||
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean'
      );
      acc[key] = normalized;
      return acc;
    }

    if (isRecord(item)) {
      const nested = Object.entries(item).reduce<Record<string, string | number | boolean | null>>((nestedAcc, [nestedKey, nestedValue]) => {
        if (
          nestedValue === null ||
          typeof nestedValue === 'string' ||
          typeof nestedValue === 'number' ||
          typeof nestedValue === 'boolean'
        ) {
          nestedAcc[nestedKey] = nestedValue;
        }
        return nestedAcc;
      }, {});
      acc[key] = nested;
    }

    return acc;
  }, {});
}

function asRelationEdge(value: unknown): KnowledgeRelationEdge | null {
  if (!isRecord(value)) {
    return null;
  }

  const predicateId = asString(value.predicateId);
  const targetId = asString(value.targetId);
  if (!predicateId || !targetId) {
    return null;
  }

  return {
    predicateId,
    targetId,
    source: asString(value.source) || undefined,
    confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
  };
}

function normalizeOntologyClass(value: unknown): OntologyClass | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asString(value.id);
  if (!id) {
    return null;
  }

  return {
    id,
    label: asString(value.label, id),
    description: asString(value.description),
    parentIds: asStringArray(value.parentIds),
  };
}

function normalizeOntologyRelation(value: unknown): OntologyRelation | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asString(value.id);
  if (!id) {
    return null;
  }

  return {
    id,
    label: asString(value.label, id),
    description: asString(value.description),
    domain: asStringArray(value.domain),
    range: asStringArray(value.range),
    inverseId: asString(value.inverseId) || undefined,
    transitive: value.transitive === true,
    symmetric: value.symmetric === true,
  };
}

function normalizeEntity(value: unknown): KnowledgeEntity | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asString(value.id);
  const typeId = asString(value.typeId);
  const title = asString(value.title);
  if (!id || !typeId || !title) {
    return null;
  }

  return {
    id,
    typeId,
    title,
    summary: asString(value.summary),
    aliases: asStringArray(value.aliases),
    tags: asStringArray(value.tags),
    attributes: asAttributes(value.attributes),
    relations: Array.isArray(value.relations)
      ? value.relations.map(asRelationEdge).filter((edge): edge is KnowledgeRelationEdge => Boolean(edge))
      : [],
    source: asString(value.source) || undefined,
    confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
    createdAt: asNumber(value.createdAt),
    updatedAt: asNumber(value.updatedAt),
  };
}

function normalizeDocument(value: unknown): KnowledgeDocument | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asString(value.id);
  const title = asString(value.title);
  if (!id || !title) {
    return null;
  }

  return {
    id,
    title,
    summary: asString(value.summary),
    content: asString(value.content),
    tags: asStringArray(value.tags),
    entityIds: asStringArray(value.entityIds),
    source: asString(value.source) || undefined,
    createdAt: asNumber(value.createdAt),
    updatedAt: asNumber(value.updatedAt),
  };
}

function normalizeAssertion(value: unknown): KnowledgeAssertion | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asString(value.id);
  const subjectId = asString(value.subjectId);
  const predicateId = asString(value.predicateId);
  if (!id || !subjectId || !predicateId) {
    return null;
  }

  const normalizedValue =
    value.value === null ||
    typeof value.value === 'string' ||
    typeof value.value === 'number' ||
    typeof value.value === 'boolean'
      ? value.value
      : undefined;

  return {
    id,
    subjectId,
    predicateId,
    objectId: asString(value.objectId) || undefined,
    value: normalizedValue,
    evidenceDocumentIds: asStringArray(value.evidenceDocumentIds),
    source: asString(value.source) || undefined,
    confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
    createdAt: asNumber(value.createdAt),
    updatedAt: asNumber(value.updatedAt),
  };
}

export function normalizeKnowledgeDataset(raw: unknown): KnowledgeDataset {
  const dataset = isRecord(raw) ? raw : {};
  const ontology = isRecord(dataset.ontology) ? dataset.ontology : {};

  return {
    context: asContext(dataset.context),
    ontology: {
      classes: Array.isArray(ontology.classes)
        ? ontology.classes.map(normalizeOntologyClass).filter((item): item is OntologyClass => Boolean(item))
        : DEFAULT_KNOWLEDGE_DATASET.ontology.classes,
      relations: Array.isArray(ontology.relations)
        ? ontology.relations.map(normalizeOntologyRelation).filter((item): item is OntologyRelation => Boolean(item))
        : DEFAULT_KNOWLEDGE_DATASET.ontology.relations,
    },
    entities: Array.isArray(dataset.entities)
      ? dataset.entities.map(normalizeEntity).filter((item): item is KnowledgeEntity => Boolean(item))
      : DEFAULT_KNOWLEDGE_DATASET.entities,
    documents: Array.isArray(dataset.documents)
      ? dataset.documents.map(normalizeDocument).filter((item): item is KnowledgeDocument => Boolean(item))
      : DEFAULT_KNOWLEDGE_DATASET.documents,
    assertions: Array.isArray(dataset.assertions)
      ? dataset.assertions.map(normalizeAssertion).filter((item): item is KnowledgeAssertion => Boolean(item))
      : DEFAULT_KNOWLEDGE_DATASET.assertions,
    updatedAt: asNumber(dataset.updatedAt, Date.now()),
  };
}

export function cloneKnowledgeDataset(dataset: KnowledgeDataset): KnowledgeDataset {
  return JSON.parse(JSON.stringify(dataset)) as KnowledgeDataset;
}
