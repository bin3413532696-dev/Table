import { fetchWithAuth } from './auth';

export type UnifiedSearchModule = 'task' | 'finance' | 'knowledge';

export type UnifiedSearchRecord =
  | {
      module: 'task';
      kind: 'task';
      id: string;
      title: string;
      summary: string;
      score: number;
      rankingScore: number;
      updatedAt: number;
      metadata: {
        completed: boolean;
        priority: string;
        dueDate?: string;
      };
    }
  | {
      module: 'finance';
      kind: 'finance-record';
      id: string;
      title: string;
      summary: string;
      score: number;
      rankingScore: number;
      updatedAt: number;
      metadata: {
        type: string;
        amount: number;
        category: string;
        date: string;
        model?: string;
      };
    }
  | {
      module: 'knowledge';
      kind: 'entity' | 'document';
      id: string;
      title: string;
      summary: string;
      score: number;
      rankingScore: number;
      updatedAt?: number;
      metadata: {
        typeId?: string;
        tags: string[];
      };
    };

type UnifiedSearchResponse = {
  items: UnifiedSearchRecord[];
  total: number;
  source: string;
};

export interface UnifiedSearchFilters {
  modules?: UnifiedSearchModule[];
  limit?: number;
  includeKnowledgeDocuments?: boolean;
  knowledgeTypeIds?: string[];
  knowledgeTags?: string[];
}

export async function searchAllRemote(
  query: string,
  filters: UnifiedSearchFilters = {}
): Promise<UnifiedSearchRecord[]> {
  const params = new URLSearchParams();

  if (query.trim()) {
    params.set('query', query.trim());
  }

  if (filters.modules && filters.modules.length > 0) {
    for (const module of filters.modules) {
      params.append('modules', module);
    }
  }

  if (filters.limit !== undefined) {
    params.set('limit', String(filters.limit));
  }

  if (filters.includeKnowledgeDocuments !== undefined) {
    params.set('includeKnowledgeDocuments', String(filters.includeKnowledgeDocuments));
  }

  if (filters.knowledgeTypeIds && filters.knowledgeTypeIds.length > 0) {
    for (const typeId of filters.knowledgeTypeIds) {
      params.append('knowledgeTypeIds', typeId);
    }
  }

  if (filters.knowledgeTags && filters.knowledgeTags.length > 0) {
    for (const tag of filters.knowledgeTags) {
      params.append('knowledgeTags', tag);
    }
  }

  const response = await fetchWithAuth(`/api/search?${params.toString()}`);
  if (!response.ok) {
    let message = `Unified search request failed: HTTP ${response.status}`;

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

  const payload = await response.json() as UnifiedSearchResponse;
  return payload.items;
}
