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

type EntityListResponse = {
  items: KnowledgeEntity[];
  total: number;
  source: string;
};

type DocumentListResponse = {
  items: KnowledgeDocument[];
  total: number;
  source: string;
};

type AssertionListResponse = {
  items: KnowledgeAssertion[];
  total: number;
  source: string;
};

export async function loadKnowledgeDatasetFromServer(): Promise<KnowledgeDataset> {
  const payload = (await syncEngine.loadKnowledgeFromServer()) as LoadDataResponse;
  if (!payload.success) {
    throw new Error(payload.error || 'Failed to load knowledge data');
  }

  return hydrateKnowledgeDataset(payload.data?.knowledge);
}

async function requestKnowledgeApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    let message = `Knowledge API request failed: HTTP ${response.status}`;

    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // noop
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function refreshKnowledgeDataset(): Promise<KnowledgeDataset> {
  return loadKnowledgeDatasetFromServer();
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
  const result = await syncEngine.syncNow();
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
  const entity = input.id
    ? await requestKnowledgeApi<KnowledgeEntity>(`/api/knowledge/entities/${encodeURIComponent(input.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      })
    : await requestKnowledgeApi<KnowledgeEntity>('/api/knowledge/entities', {
        method: 'POST',
        body: JSON.stringify(input),
      });

  await refreshKnowledgeDataset();
  return entity;
}

export async function upsertKnowledgeDocument(
  input: UpsertKnowledgeDocumentInput
): Promise<KnowledgeDocument> {
  const document = input.id
    ? await requestKnowledgeApi<KnowledgeDocument>(`/api/knowledge/documents/${encodeURIComponent(input.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      })
    : await requestKnowledgeApi<KnowledgeDocument>('/api/knowledge/documents', {
        method: 'POST',
        body: JSON.stringify(input),
      });

  await refreshKnowledgeDataset();
  return document;
}

export async function upsertKnowledgeAssertion(
  input: UpsertKnowledgeAssertionInput
): Promise<KnowledgeAssertion> {
  const assertion = input.id
    ? await requestKnowledgeApi<KnowledgeAssertion>(`/api/knowledge/assertions/${encodeURIComponent(input.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      })
    : await requestKnowledgeApi<KnowledgeAssertion>('/api/knowledge/assertions', {
        method: 'POST',
        body: JSON.stringify(input),
      });

  await refreshKnowledgeDataset();
  return assertion;
}

export async function deleteKnowledgeRelation(
  subjectId: string,
  predicateId: string,
  targetId: string
): Promise<void> {
  await requestKnowledgeApi<void>('/api/knowledge/relations', {
    method: 'DELETE',
    body: JSON.stringify({
      subjectId,
      predicateId,
      targetId,
    }),
  });

  await refreshKnowledgeDataset();
}

export async function deleteKnowledgeAssertion(id: string): Promise<void> {
  await requestKnowledgeApi<void>(`/api/knowledge/assertions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  await refreshKnowledgeDataset();
}

export async function deleteKnowledgeDocument(id: string): Promise<void> {
  await requestKnowledgeApi<void>(`/api/knowledge/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  await refreshKnowledgeDataset();
}

export async function deleteKnowledgeEntity(id: string): Promise<void> {
  await requestKnowledgeApi<void>(`/api/knowledge/entities/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  await refreshKnowledgeDataset();
}

export async function createKnowledgeRelation(
  input: CreateKnowledgeRelationInput
): Promise<KnowledgeAssertion> {
  const assertion = await requestKnowledgeApi<KnowledgeAssertion>('/api/knowledge/relations', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  await refreshKnowledgeDataset();
  return assertion;
}
