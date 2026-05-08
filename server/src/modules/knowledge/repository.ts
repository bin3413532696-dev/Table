import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client';
import { getCurrentUserId } from '../../shared/user-context';
import { toNoteDto, toPresetTagDto } from './dto';
import type {
  CreateNoteInput,
  UpdateNoteInput,
  NoteSearchQueryInput,
  CreatePresetTagInput,
  UpdatePresetTagInput,
} from './schema';

export type KnowledgeNoteRecord = ReturnType<typeof toNoteDto>;
export type KnowledgePresetTagRecord = ReturnType<typeof toPresetTagDto>;

export type KnowledgeSearchResult = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  score: number;
  updatedAt: number;
};

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toTimestamp(value: Date): number {
  return value.getTime();
}

function escapeLikePattern(input: string) {
  return input.replace(/[\\%_]/g, '\\$&');
}

export async function listNotes(): Promise<KnowledgeNoteRecord[]> {
  const userId = getCurrentUserId();
  const notes = await prisma.knowledgeNote.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });

  return notes.map(toNoteDto);
}

export async function createNote(input: CreateNoteInput): Promise<KnowledgeNoteRecord> {
  const userId = getCurrentUserId();
  const now = new Date();
  const note = await prisma.knowledgeNote.create({
    data: {
      userId,
      title: input.title.trim(),
      content: input.content ?? '',
      tagsJson: asJsonValue(input.tags ?? []),
      createdAt: now,
      updatedAt: now,
    },
  });

  return toNoteDto(note);
}

export async function findNoteById(id: string): Promise<KnowledgeNoteRecord | null> {
  const userId = getCurrentUserId();
  const note = await prisma.knowledgeNote.findFirst({
    where: { id, userId, deletedAt: null },
  });

  if (!note) return null;

  return toNoteDto(note);
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<KnowledgeNoteRecord | null> {
  const userId = getCurrentUserId();
  const existing = await prisma.knowledgeNote.findFirst({
    where: { id, userId, deletedAt: null },
  });

  if (!existing) return null;

  const note = await prisma.knowledgeNote.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.tags !== undefined ? { tagsJson: asJsonValue(input.tags) } : {}),
      updatedAt: new Date(),
    },
  });

  return toNoteDto(note);
}

export async function deleteNote(id: string): Promise<boolean> {
  const userId = getCurrentUserId();
  const existing = await prisma.knowledgeNote.findFirst({
    where: { id, userId, deletedAt: null },
  });

  if (!existing) return false;

  await prisma.knowledgeNote.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return true;
}

export async function searchNotes(input: NoteSearchQueryInput): Promise<KnowledgeSearchResult[]> {
  const userId = getCurrentUserId();
  const rawQuery = input.query.trim();
  const normalizedTags = Array.isArray(input.tags)
    ? input.tags.map((item) => item.trim()).filter(Boolean)
    : typeof input.tags === 'string' && input.tags.trim()
      ? [input.tags.trim()]
      : [];

  const hasQuery = rawQuery.length > 0;
  const tsquery = hasQuery
    ? rawQuery
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.replace(/[&|!():'"\\]/g, ''))
        .join(' & ')
    : '';
  const escapedQuery = hasQuery ? `%${escapeLikePattern(rawQuery)}%` : '';
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;

  const tagFilter = normalizedTags.length > 0
    ? Prisma.sql`
        and exists (
          select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(n.tags_json) = 'array' then n.tags_json
              else '[]'::jsonb
            end
          ) as tag(value)
          where tag.value in (${Prisma.join(normalizedTags)})
        )
      `
    : Prisma.empty;

  const searchFilter = hasQuery
    ? Prisma.sql`
        and (
          to_tsvector('simple', n.title) @@ to_tsquery('simple', ${tsquery})
          or to_tsvector('simple', n.content) @@ to_tsquery('simple', ${tsquery})
          or n.title ilike ${escapedQuery} escape '\'
          or n.content ilike ${escapedQuery} escape '\'
        )
      `
    : Prisma.empty;

  type SearchRow = {
    id: string;
    title: string;
    content: string;
    tagsJson: unknown;
    score: number;
    updatedAt: Date;
  };

  const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    select
      n.id,
      n.title,
      n.content,
      n.tags_json as "tagsJson",
      ${
        hasQuery
          ? Prisma.sql`
              case
                when to_tsvector('simple', n.title) @@ to_tsquery('simple', ${tsquery}) then 2.0
                when to_tsvector('simple', n.content) @@ to_tsquery('simple', ${tsquery}) then 1.0
                when n.title ilike ${escapedQuery} escape '\' then 0.8
                when n.content ilike ${escapedQuery} escape '\' then 0.4
                else 0
              end
            `
          : Prisma.sql`0::double precision`
      } as score,
      n.updated_at as "updatedAt"
    from knowledge_notes n
    where n.user_id = cast(${userId} as uuid)
      and n.deleted_at is null
    ${tagFilter}
    ${searchFilter}
    order by score desc, n.updated_at desc
    limit ${limit}
    offset ${offset}
  `);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    tags: toStringArray(row.tagsJson),
    score: Number(row.score ?? 0),
    updatedAt: toTimestamp(row.updatedAt),
  }));
}

export async function listAllTags(): Promise<string[]> {
  const userId = getCurrentUserId();

  type TagRow = { tag: string };

  const rows = await prisma.$queryRaw<TagRow[]>(Prisma.sql`
    select distinct tag.value as tag
    from knowledge_notes n
    cross join jsonb_array_elements_text(
      case
        when jsonb_typeof(n.tags_json) = 'array' then n.tags_json
        else '[]'::jsonb
      end
    ) as tag(value)
    where n.user_id = cast(${userId} as uuid)
      and n.deleted_at is null
    order by tag.value asc
  `);

  return rows.map((row) => row.tag);
}

export async function listPresetTags(): Promise<KnowledgePresetTagRecord[]> {
  const userId = getCurrentUserId();
  const tags = await prisma.knowledgePresetTag.findMany({
    where: { userId },
    orderBy: { sortOrder: 'asc' },
  });

  return tags.map(toPresetTagDto);
}

export async function createPresetTag(input: CreatePresetTagInput): Promise<KnowledgePresetTagRecord> {
  const userId = getCurrentUserId();
  const now = new Date();

  const maxSort = await prisma.knowledgePresetTag.aggregate({
    where: { userId },
    _max: { sortOrder: true },
  });

  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const tag = await prisma.knowledgePresetTag.create({
    data: {
      userId,
      name: input.name.trim(),
      color: input.color ?? '#6B7280',
      sortOrder,
      createdAt: now,
      updatedAt: now,
    },
  });

  return toPresetTagDto(tag);
}

export async function findPresetTagById(id: string): Promise<KnowledgePresetTagRecord | null> {
  const userId = getCurrentUserId();
  const tag = await prisma.knowledgePresetTag.findFirst({
    where: { id, userId },
  });

  if (!tag) return null;

  return toPresetTagDto(tag);
}

export async function updatePresetTag(id: string, input: UpdatePresetTagInput): Promise<KnowledgePresetTagRecord | null> {
  const userId = getCurrentUserId();
  const existing = await prisma.knowledgePresetTag.findFirst({
    where: { id, userId },
  });

  if (!existing) return null;

  const tag = await prisma.knowledgePresetTag.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedAt: new Date(),
    },
  });

  return toPresetTagDto(tag);
}

export async function deletePresetTag(id: string): Promise<boolean> {
  const userId = getCurrentUserId();
  const existing = await prisma.knowledgePresetTag.findFirst({
    where: { id, userId },
  });

  if (!existing) return false;

  await prisma.knowledgePresetTag.delete({
    where: { id },
  });

  return true;
}

export async function getKnowledgeMetadata() {
  const userId = getCurrentUserId();
  const noteCount = await prisma.knowledgeNote.count({
    where: { userId },
  });
  const presetTagCount = await prisma.knowledgePresetTag.count({
    where: { userId },
  });

  return {
    noteCount,
    presetTagCount,
  };
}