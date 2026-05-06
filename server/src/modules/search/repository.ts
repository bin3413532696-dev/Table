import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import { searchKnowledgeRecords, type KnowledgeSearchRecord } from '../knowledge/repository';
import type { UnifiedSearchQueryInput } from './schema';

type UnifiedSearchModule = 'task' | 'finance' | 'knowledge';

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

type TaskSearchRow = {
  id: string;
  title: string;
  completed: boolean;
  priority: string;
  dueDate: Date | null;
  notes: string | null;
  updatedAt: Date;
  score: number;
};

type FinanceSearchRow = {
  id: string;
  type: string;
  amount: Prisma.Decimal;
  category: string;
  description: string;
  recordDate: Date;
  model: string | null;
  updatedAt: Date;
  score: number;
};

const DEFAULT_UNIFIED_SEARCH_MODULES: UnifiedSearchModule[] = ['task', 'finance', 'knowledge'];

function normalizeStringList(input?: string | string[]) {
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map((item) => item.trim()).filter(Boolean)));
  }

  if (typeof input === 'string' && input.trim()) {
    return [input.trim()];
  }

  return [];
}

function escapeLikePattern(input: string) {
  return input.replace(/[\\%_]/g, '\\$&');
}

function buildTaskSearchVectorSql() {
  return Prisma.sql`
    setweight(to_tsvector('simple', coalesce(t.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(t.notes, '')), 'B')
  `;
}

function buildFinanceSearchVectorSql() {
  return Prisma.sql`
    setweight(to_tsvector('simple', coalesce(f.description, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(f.category, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(f.model, '')), 'C')
  `;
}

function sortByScoreAndTime<T extends { score: number; updatedAt?: number }>(items: T[]) {
  return items.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  });
}

function computeRecencyBoost(updatedAt?: number) {
  if (!updatedAt) {
    return 0;
  }

  const ageHours = Math.max(0, (Date.now() - updatedAt) / (1000 * 60 * 60));
  return Math.max(0, 0.18 - ageHours * 0.0025);
}

function computeModuleWeight(module: UnifiedSearchModule) {
  if (module === 'knowledge') {
    return 1.05;
  }

  if (module === 'task') {
    return 1;
  }

  return 0.98;
}

function computeRankingScore(item: {
  module: UnifiedSearchModule;
  score: number;
  updatedAt?: number;
  title: string;
}, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTitle = item.title.trim().toLowerCase();
  const exactTitleBoost = normalizedQuery && normalizedTitle === normalizedQuery ? 0.45 : 0;
  const prefixTitleBoost =
    normalizedQuery && normalizedTitle.startsWith(normalizedQuery) && normalizedTitle !== normalizedQuery
      ? 0.2
      : 0;
  const titleIncludesBoost =
    normalizedQuery && normalizedTitle.includes(normalizedQuery) && !normalizedTitle.startsWith(normalizedQuery)
      ? 0.08
      : 0;
  const recencyBoost = computeRecencyBoost(item.updatedAt);
  const moduleWeight = computeModuleWeight(item.module);

  return (item.score + exactTitleBoost + prefixTitleBoost + titleIncludesBoost + recencyBoost) * moduleWeight;
}

function takeBalancedTopResults(items: UnifiedSearchRecord[], modules: UnifiedSearchModule[], limit: number) {
  if (items.length <= limit) {
    return items;
  }

  const enabledModules: UnifiedSearchModule[] = modules.length > 0 ? modules : DEFAULT_UNIFIED_SEARCH_MODULES;
  const groups = new Map<UnifiedSearchModule, UnifiedSearchRecord[]>();
  for (const module of enabledModules) {
    groups.set(module, items.filter((item) => item.module === module));
  }

  const minPerModule = Math.max(1, Math.floor(limit / Math.max(enabledModules.length, 1)));
  const selected: UnifiedSearchRecord[] = [];

  for (const module of enabledModules) {
    const moduleItems = groups.get(module) ?? [];
    selected.push(...moduleItems.slice(0, minPerModule));
  }

  const selectedKeys = new Set(selected.map((item) => `${item.module}:${item.kind}:${item.id}`));
  const remaining = items.filter((item) => !selectedKeys.has(`${item.module}:${item.kind}:${item.id}`));

  return [...selected, ...remaining]
    .sort((left, right) => {
      if (right.rankingScore !== left.rankingScore) {
        return right.rankingScore - left.rankingScore;
      }

      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    })
    .slice(0, limit);
}

function toKnowledgeUnifiedRecord(item: KnowledgeSearchRecord): UnifiedSearchRecord {
  return {
    module: 'knowledge',
    kind: item.kind,
    id: item.id,
    title: item.title,
    summary: item.summary,
    score: item.score,
    rankingScore: item.score,
    metadata: {
      ...(item.typeId ? { typeId: item.typeId } : {}),
      tags: item.tags,
    },
  };
}

async function searchTasks(query: string, limit: number) {
  const userId = getCurrentUserId();
  const hasQuery = query.length > 0;
  const escapedQuery = hasQuery ? `%${escapeLikePattern(query)}%` : '';
  const taskSearchVector = buildTaskSearchVectorSql();
  const searchFilter = hasQuery
    ? Prisma.sql`
        and (
          ${taskSearchVector} @@ websearch_to_tsquery('simple', ${query})
          or t.title ilike ${escapedQuery} escape '\'
          or coalesce(t.notes, '') ilike ${escapedQuery} escape '\'
        )
      `
    : Prisma.empty;

  const rows = await prisma.$queryRaw<TaskSearchRow[]>(Prisma.sql`
    select
      t.id,
      t.title,
      t.completed,
      t.priority,
      t.due_date as "dueDate",
      t.notes,
      t.updated_at as "updatedAt",
      ${
        hasQuery
          ? Prisma.sql`
              greatest(
                ts_rank_cd(${taskSearchVector}, websearch_to_tsquery('simple', ${query})),
                case
                  when t.title ilike ${escapedQuery} escape '\' then 0.85
                  when coalesce(t.notes, '') ilike ${escapedQuery} escape '\' then 0.35
                  else 0
                end
              )
            `
          : Prisma.sql`0::double precision`
      } as score
    from tasks t
    where t.user_id = cast(${userId} as uuid)
      and t.deleted_at is null
      ${searchFilter}
    order by score desc, t.updated_at desc
    limit ${limit}
  `);

  return rows.map((item): UnifiedSearchRecord => ({
    module: 'task',
    kind: 'task',
    id: item.id,
    title: item.title,
    summary: item.notes ?? '',
    score: Number(item.score ?? 0),
    rankingScore: Number(item.score ?? 0),
    updatedAt: item.updatedAt.getTime(),
    metadata: {
      completed: item.completed,
      priority: item.priority,
      ...(item.dueDate ? { dueDate: item.dueDate.toISOString().slice(0, 10) } : {}),
    },
  }));
}

async function searchFinance(query: string, limit: number) {
  const userId = getCurrentUserId();
  const hasQuery = query.length > 0;
  const escapedQuery = hasQuery ? `%${escapeLikePattern(query)}%` : '';
  const financeSearchVector = buildFinanceSearchVectorSql();
  const searchFilter = hasQuery
    ? Prisma.sql`
        and (
          ${financeSearchVector} @@ websearch_to_tsquery('simple', ${query})
          or f.description ilike ${escapedQuery} escape '\'
          or f.category ilike ${escapedQuery} escape '\'
          or coalesce(f.model, '') ilike ${escapedQuery} escape '\'
        )
      `
    : Prisma.empty;

  const rows = await prisma.$queryRaw<FinanceSearchRow[]>(Prisma.sql`
    select
      f.id,
      f.type,
      f.amount,
      f.category,
      f.description,
      f.record_date as "recordDate",
      f.model,
      f.updated_at as "updatedAt",
      ${
        hasQuery
          ? Prisma.sql`
              greatest(
                ts_rank_cd(${financeSearchVector}, websearch_to_tsquery('simple', ${query})),
                case
                  when f.description ilike ${escapedQuery} escape '\' then 0.85
                  when f.category ilike ${escapedQuery} escape '\' then 0.45
                  when coalesce(f.model, '') ilike ${escapedQuery} escape '\' then 0.2
                  else 0
                end
              )
            `
          : Prisma.sql`0::double precision`
      } as score
    from finance_records f
    where f.user_id = cast(${userId} as uuid)
      and f.deleted_at is null
      ${searchFilter}
    order by score desc, f.updated_at desc
    limit ${limit}
  `);

  return rows.map((item): UnifiedSearchRecord => ({
    module: 'finance',
    kind: 'finance-record',
    id: item.id,
    title: item.description,
    summary: `${item.category} / ${item.type}${item.model ? ` / ${item.model}` : ''}`,
    score: Number(item.score ?? 0),
    rankingScore: Number(item.score ?? 0),
    updatedAt: item.updatedAt.getTime(),
    metadata: {
      type: item.type,
      amount: Number(item.amount),
      category: item.category,
      date: item.recordDate.toISOString().slice(0, 10),
      ...(item.model ? { model: item.model } : {}),
    },
  }));
}

export async function searchAllRecords(input: UnifiedSearchQueryInput) {
  const modules = normalizeStringList(input.modules) as Array<'task' | 'finance' | 'knowledge'>;
  const enabledModules = modules.length > 0
    ? new Set<UnifiedSearchModule>(modules)
    : new Set<UnifiedSearchModule>(DEFAULT_UNIFIED_SEARCH_MODULES);
  const query = input.query.trim();
  const limit = input.limit ?? 20;
  const perModuleLimit = Math.max(limit, 10);

  const [tasks, finance, knowledge] = await Promise.all([
    enabledModules.has('task') ? searchTasks(query, perModuleLimit) : Promise.resolve([] as UnifiedSearchRecord[]),
    enabledModules.has('finance') ? searchFinance(query, perModuleLimit) : Promise.resolve([] as UnifiedSearchRecord[]),
    enabledModules.has('knowledge')
      ? searchKnowledgeRecords({
          query,
          includeDocuments: input.includeKnowledgeDocuments,
          limit: perModuleLimit,
          typeIds: input.knowledgeTypeIds,
          tags: input.knowledgeTags,
        }).then((items) => items.map(toKnowledgeUnifiedRecord))
      : Promise.resolve([] as UnifiedSearchRecord[]),
  ]);

  const enabledModuleList = Array.from(enabledModules) as UnifiedSearchModule[];
  const ranked = sortByScoreAndTime(
    [...tasks, ...finance, ...knowledge].map((item) => ({
      ...item,
      rankingScore: computeRankingScore(item, query),
    }))
  ).sort((left, right) => {
    if (right.rankingScore !== left.rankingScore) {
      return right.rankingScore - left.rankingScore;
    }

    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  });

  return takeBalancedTopResults(ranked, enabledModuleList, limit);
}
