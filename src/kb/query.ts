import Fuse from 'fuse.js';
import { KnowledgeDataset, KnowledgeDocument, KnowledgeEntity, KnowledgeOverview, KnowledgeSearchFilters, KnowledgeSearchHit } from './types';
import { expandEntityRelations } from './rules';

interface EntitySearchIndexRow {
  id: string;
  title: string;
  summary: string;
  typeId: string;
  tags: string[];
  aliases: string[];
  updatedAt: number;
}

interface DocumentSearchIndexRow {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  updatedAt: number;
}

export function createEntityFuse(entities: KnowledgeEntity[]): Fuse<EntitySearchIndexRow> {
  return new Fuse(
    entities.map((entity) => ({
      id: entity.id,
      title: entity.title,
      summary: entity.summary,
      typeId: entity.typeId,
      tags: entity.tags,
      aliases: entity.aliases,
      updatedAt: entity.updatedAt,
    })),
    {
      includeScore: true,
      threshold: 0.35,
      keys: [
        { name: 'title', weight: 0.45 },
        { name: 'aliases', weight: 0.2 },
        { name: 'summary', weight: 0.2 },
        { name: 'tags', weight: 0.15 },
      ],
    }
  );
}

export function createDocumentFuse(documents: KnowledgeDocument[]): Fuse<DocumentSearchIndexRow> {
  return new Fuse(
    documents.map((document) => ({
      id: document.id,
      title: document.title,
      summary: document.summary,
      content: document.content,
      tags: document.tags,
      updatedAt: document.updatedAt,
    })),
    {
      includeScore: true,
      threshold: 0.4,
      keys: [
        { name: 'title', weight: 0.35 },
        { name: 'summary', weight: 0.25 },
        { name: 'content', weight: 0.25 },
        { name: 'tags', weight: 0.15 },
      ],
    }
  );
}

function matchesFilters(
  hit: KnowledgeSearchHit,
  dataset: KnowledgeDataset,
  filters: KnowledgeSearchFilters
): boolean {
  if (filters.typeIds && filters.typeIds.length > 0) {
    if (hit.kind !== 'entity' || !hit.typeId || !filters.typeIds.includes(hit.typeId)) {
      return false;
    }
  }

  if (filters.tags && filters.tags.length > 0) {
    if (!filters.tags.every((tag) => hit.tags.includes(tag))) {
      return false;
    }
  }

  if (!filters.includeDocuments && hit.kind === 'document') {
    return false;
  }

  if (hit.kind === 'document' && !dataset.documents.some((document) => document.id === hit.id)) {
    return false;
  }

  return true;
}

export function searchKnowledgeDataset(
  dataset: KnowledgeDataset,
  entityFuse: Fuse<EntitySearchIndexRow>,
  documentFuse: Fuse<DocumentSearchIndexRow>,
  query: string,
  filters: KnowledgeSearchFilters = {}
): KnowledgeSearchHit[] {
  const limit = filters.limit ?? 10;
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    const recentEntities = dataset.entities
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map<KnowledgeSearchHit>((entity) => ({
        kind: 'entity',
        id: entity.id,
        title: entity.title,
        summary: entity.summary,
        score: 0,
        typeId: entity.typeId,
        tags: entity.tags,
      }));

    const recentDocuments = filters.includeDocuments
      ? dataset.documents
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, limit)
          .map<KnowledgeSearchHit>((document) => ({
            kind: 'document',
            id: document.id,
            title: document.title,
            summary: document.summary,
            score: 0,
            tags: document.tags,
          }))
      : [];

    return [...recentEntities, ...recentDocuments]
      .filter((hit) => matchesFilters(hit, dataset, filters))
      .slice(0, limit);
  }

  const entityHits = entityFuse.search(normalizedQuery).map<KnowledgeSearchHit>((result) => ({
    kind: 'entity',
    id: result.item.id,
    title: result.item.title,
    summary: result.item.summary,
    score: result.score ?? 0,
    typeId: result.item.typeId,
    tags: result.item.tags,
  }));

  const documentHits = filters.includeDocuments
    ? documentFuse.search(normalizedQuery).map<KnowledgeSearchHit>((result) => ({
        kind: 'document',
        id: result.item.id,
        title: result.item.title,
        summary: result.item.summary,
        score: result.score ?? 0,
        tags: result.item.tags,
      }))
    : [];

  return [...entityHits, ...documentHits]
    .filter((hit) => matchesFilters(hit, dataset, filters))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}

export function buildKnowledgeOverview(dataset: KnowledgeDataset): KnowledgeOverview {
  return {
    classCount: dataset.ontology.classes.length,
    relationCount: dataset.ontology.relations.length,
    entityCount: dataset.entities.length,
    documentCount: dataset.documents.length,
    assertionCount: dataset.assertions.length,
    lastUpdatedAt: dataset.updatedAt,
  };
}

export function getRelatedKnowledgeEntities(
  dataset: KnowledgeDataset,
  entityId: string,
  depth = 1
): KnowledgeEntity[] {
  return expandEntityRelations(dataset, entityId, depth);
}
