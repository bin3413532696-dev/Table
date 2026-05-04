import {
  KnowledgeDataset,
  KnowledgeDocument,
  KnowledgeEntity,
  KnowledgeOverview,
  KnowledgeSearchFilters,
  KnowledgeSearchHit,
} from './types';
import { DEFAULT_KNOWLEDGE_DATASET, KNOWLEDGE_STORAGE_KEY } from './schema';
import { cloneKnowledgeDataset, normalizeKnowledgeDataset } from './serializer';
import { buildKnowledgeOverview, createDocumentFuse, createEntityFuse, getRelatedKnowledgeEntities, searchKnowledgeDataset } from './query';

type Listener = () => void;

let dataset = cloneKnowledgeDataset(DEFAULT_KNOWLEDGE_DATASET);
let entityFuse = createEntityFuse(dataset.entities);
let documentFuse = createDocumentFuse(dataset.documents);
const listeners = new Set<Listener>();

function rebuildIndexes(nextDataset: KnowledgeDataset) {
  entityFuse = createEntityFuse(nextDataset.entities);
  documentFuse = createDocumentFuse(nextDataset.documents);
}

async function cacheDataset(nextDataset: KnowledgeDataset): Promise<void> {
  void nextDataset;
}

function persistSnapshot(nextDataset: KnowledgeDataset): void {
  try {
    localStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(nextDataset));
  } catch (error) {
    console.warn('[KB] Failed to persist snapshot:', error);
  }
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export async function hydrateKnowledgeDataset(raw: unknown): Promise<KnowledgeDataset> {
  const nextDataset = normalizeKnowledgeDataset(raw);
  dataset = cloneKnowledgeDataset(nextDataset);
  rebuildIndexes(dataset);
  persistSnapshot(dataset);
  await cacheDataset(dataset);
  notify();
  return getKnowledgeDataset();
}

export function restoreKnowledgeDatasetFromCache(): KnowledgeDataset {
  try {
    const cached = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
    if (!cached) {
      return getKnowledgeDataset();
    }

    dataset = normalizeKnowledgeDataset(JSON.parse(cached));
    rebuildIndexes(dataset);
    return getKnowledgeDataset();
  } catch {
    return getKnowledgeDataset();
  }
}

export function getKnowledgeDataset(): KnowledgeDataset {
  return cloneKnowledgeDataset(dataset);
}

export function getKnowledgeOverview(): KnowledgeOverview {
  return buildKnowledgeOverview(dataset);
}

export function searchKnowledge(
  query: string,
  filters: KnowledgeSearchFilters = {}
): KnowledgeSearchHit[] {
  return searchKnowledgeDataset(dataset, entityFuse, documentFuse, query, filters);
}

export function getKnowledgeEntityById(id: string): KnowledgeEntity | undefined {
  return dataset.entities.find((entity) => entity.id === id);
}

export function getKnowledgeDocumentById(id: string): KnowledgeDocument | undefined {
  return dataset.documents.find((document) => document.id === id);
}

export function getKnowledgeRelatedById(id: string, depth = 1): KnowledgeEntity[] {
  return getRelatedKnowledgeEntities(dataset, id, depth);
}

export function subscribeKnowledge(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
