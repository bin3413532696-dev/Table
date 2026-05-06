import { getKnowledgeDataset, hydrateKnowledgeDataset } from './store';
import { syncEngine } from '../sync';
import { fetchWithAuth } from '../lib/auth';
import {
  KnowledgeAssertion,
  KnowledgeDataset,
  KnowledgeDocument,
  KnowledgeEntity,
  KnowledgeSearchFilters,
  KnowledgeSearchHit,
  OntologyClass,
  OntologyRelation,
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

type OntologyClassListResponse = {
  items: OntologyClass[];
  total: number;
  source: string;
};

type OntologyRelationListResponse = {
  items: OntologyRelation[];
  total: number;
  source: string;
};

interface RebuildKnowledgeProjectionsResult {
  queuedTaskProjections: number;
  queuedFinanceProjections: number;
  queuedAt: string;
}

type RebuildKnowledgeProjectionsResponse = {
  data: RebuildKnowledgeProjectionsResult;
  source: string;
};

type KnowledgeSearchResponse = {
  items: KnowledgeSearchHit[];
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
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init?.body !== null;

  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetchWithAuth(path, {
    ...init,
    headers,
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

export interface UpsertOntologyClassInput {
  id: string;
  label: string;
  description?: string;
  parentIds?: string[];
}

export interface UpsertOntologyRelationInput {
  id: string;
  label: string;
  description?: string;
  inverseId?: string;
  symmetric?: boolean;
  transitive?: boolean;
}

export async function searchKnowledgeRemote(
  query: string,
  filters: KnowledgeSearchFilters = {}
): Promise<KnowledgeSearchHit[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set('query', query.trim());
  }
  if (filters.typeIds && filters.typeIds.length > 0) {
    for (const typeId of filters.typeIds) {
      params.append('typeIds', typeId);
    }
  }
  if (filters.tags && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      params.append('tags', tag);
    }
  }
  if (filters.includeDocuments !== undefined) {
    params.set('includeDocuments', String(filters.includeDocuments));
  }
  if (filters.limit !== undefined) {
    params.set('limit', String(filters.limit));
  }

  const response = await requestKnowledgeApi<KnowledgeSearchResponse>(
    `/api/knowledge/search?${params.toString()}`
  );
  return response.items;
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

export async function rebuildKnowledgeProjections(): Promise<RebuildKnowledgeProjectionsResult> {
  const response = await requestKnowledgeApi<RebuildKnowledgeProjectionsResponse>(
    '/api/knowledge/rebuild/projections',
    {
      method: 'POST',
    }
  );

  await refreshKnowledgeDataset();
  return response.data;
}

export async function listOntologyClasses(): Promise<OntologyClass[]> {
  const response = await requestKnowledgeApi<OntologyClassListResponse>('/api/knowledge/ontology/classes');
  return response.items;
}

export async function listOntologyRelations(): Promise<OntologyRelation[]> {
  const response = await requestKnowledgeApi<OntologyRelationListResponse>('/api/knowledge/ontology/relations');
  return response.items;
}

export async function upsertOntologyClass(
  input: UpsertOntologyClassInput,
  options?: { existingId?: string }
): Promise<OntologyClass> {
  const item = options?.existingId
    ? await requestKnowledgeApi<OntologyClass>(
        `/api/knowledge/ontology/classes/${encodeURIComponent(options.existingId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            label: input.label,
            description: input.description,
            parentIds: input.parentIds,
          }),
        }
      )
    : await requestKnowledgeApi<OntologyClass>('/api/knowledge/ontology/classes', {
        method: 'POST',
        body: JSON.stringify(input),
      });

  await refreshKnowledgeDataset();
  return item;
}

export async function deleteOntologyClass(id: string): Promise<void> {
  await requestKnowledgeApi<void>(`/api/knowledge/ontology/classes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  await refreshKnowledgeDataset();
}

export async function upsertOntologyRelation(
  input: UpsertOntologyRelationInput,
  options?: { existingId?: string }
): Promise<OntologyRelation> {
  const item = options?.existingId
    ? await requestKnowledgeApi<OntologyRelation>(
        `/api/knowledge/ontology/relations/${encodeURIComponent(options.existingId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            label: input.label,
            description: input.description,
            inverseId: input.inverseId ?? null,
            symmetric: input.symmetric,
            transitive: input.transitive,
          }),
        }
      )
    : await requestKnowledgeApi<OntologyRelation>('/api/knowledge/ontology/relations', {
        method: 'POST',
        body: JSON.stringify(input),
      });

  await refreshKnowledgeDataset();
  return item;
}

export async function deleteOntologyRelation(id: string): Promise<void> {
  await requestKnowledgeApi<void>(`/api/knowledge/ontology/relations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  await refreshKnowledgeDataset();
}
