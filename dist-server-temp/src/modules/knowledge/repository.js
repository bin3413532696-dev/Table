"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listNotes = listNotes;
exports.createNote = createNote;
exports.findNoteById = findNoteById;
exports.updateNote = updateNote;
exports.deleteNote = deleteNote;
exports.searchNotes = searchNotes;
exports.listAllTags = listAllTags;
exports.listPresetTags = listPresetTags;
exports.createPresetTag = createPresetTag;
exports.findPresetTagById = findPresetTagById;
exports.updatePresetTag = updatePresetTag;
exports.deletePresetTag = deletePresetTag;
exports.getKnowledgeMetadata = getKnowledgeMetadata;
const client_1 = require("@prisma/client");
const client_2 = require("../../db/client");
const user_context_1 = require("../../shared/user-context");
const dto_1 = require("./dto");
function asJsonValue(value) {
    return JSON.parse(JSON.stringify(value));
}
function toStringArray(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string')
        : [];
}
function toTimestamp(value) {
    return value.getTime();
}
function escapeLikePattern(input) {
    return input.replace(/[\\%_]/g, '\\$&');
}
async function listNotes() {
    const userId = (0, user_context_1.getCurrentUserId)();
    const notes = await client_2.prisma.knowledgeNote.findMany({
        where: { userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
    });
    return notes.map(dto_1.toNoteDto);
}
async function createNote(input) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const now = new Date();
    const note = await client_2.prisma.knowledgeNote.create({
        data: {
            userId,
            title: input.title.trim(),
            content: input.content ?? '',
            tagsJson: asJsonValue(input.tags ?? []),
            createdAt: now,
            updatedAt: now,
        },
    });
    return (0, dto_1.toNoteDto)(note);
}
async function findNoteById(id) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const note = await client_2.prisma.knowledgeNote.findFirst({
        where: { id, userId, deletedAt: null },
    });
    if (!note)
        return null;
    return (0, dto_1.toNoteDto)(note);
}
async function updateNote(id, input) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const existing = await client_2.prisma.knowledgeNote.findFirst({
        where: { id, userId, deletedAt: null },
    });
    if (!existing)
        return null;
    const note = await client_2.prisma.knowledgeNote.update({
        where: { id, userId },
        data: {
            ...(input.title !== undefined ? { title: input.title.trim() } : {}),
            ...(input.content !== undefined ? { content: input.content } : {}),
            ...(input.tags !== undefined ? { tagsJson: asJsonValue(input.tags) } : {}),
            updatedAt: new Date(),
        },
    });
    return (0, dto_1.toNoteDto)(note);
}
async function deleteNote(id) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const existing = await client_2.prisma.knowledgeNote.findFirst({
        where: { id, userId, deletedAt: null },
    });
    if (!existing)
        return false;
    await client_2.prisma.knowledgeNote.update({
        where: { id, userId },
        data: { deletedAt: new Date() },
    });
    return true;
}
async function searchNotes(input) {
    const userId = (0, user_context_1.getCurrentUserId)();
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
        ? client_1.Prisma.sql `
        and exists (
          select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(n.tags_json) = 'array' then n.tags_json
              else '[]'::jsonb
            end
          ) as tag(value)
          where tag.value in (${client_1.Prisma.join(normalizedTags)})
        )
      `
        : client_1.Prisma.empty;
    const searchFilter = hasQuery
        ? client_1.Prisma.sql `
        and (
          to_tsvector('simple', n.title) @@ to_tsquery('simple', ${tsquery})
          or to_tsvector('simple', n.content) @@ to_tsquery('simple', ${tsquery})
          or n.title ilike ${escapedQuery} escape '\'
          or n.content ilike ${escapedQuery} escape '\'
        )
      `
        : client_1.Prisma.empty;
    const rows = await client_2.prisma.$queryRaw(client_1.Prisma.sql `
    select
      n.id,
      n.title,
      n.content,
      n.tags_json as "tagsJson",
      ${hasQuery
        ? client_1.Prisma.sql `
              case
                when to_tsvector('simple', n.title) @@ to_tsquery('simple', ${tsquery}) then 2.0
                when to_tsvector('simple', n.content) @@ to_tsquery('simple', ${tsquery}) then 1.0
                when n.title ilike ${escapedQuery} escape '\' then 0.8
                when n.content ilike ${escapedQuery} escape '\' then 0.4
                else 0
              end
            `
        : client_1.Prisma.sql `0::double precision`} as score,
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
async function listAllTags() {
    const userId = (0, user_context_1.getCurrentUserId)();
    const rows = await client_2.prisma.$queryRaw(client_1.Prisma.sql `
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
async function listPresetTags() {
    const userId = (0, user_context_1.getCurrentUserId)();
    const tags = await client_2.prisma.knowledgePresetTag.findMany({
        where: { userId },
        orderBy: { sortOrder: 'asc' },
    });
    return tags.map(dto_1.toPresetTagDto);
}
async function createPresetTag(input) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const now = new Date();
    const maxSort = await client_2.prisma.knowledgePresetTag.aggregate({
        where: { userId },
        _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
    const tag = await client_2.prisma.knowledgePresetTag.create({
        data: {
            userId,
            name: input.name.trim(),
            color: input.color ?? '#6B7280',
            sortOrder,
            createdAt: now,
            updatedAt: now,
        },
    });
    return (0, dto_1.toPresetTagDto)(tag);
}
async function findPresetTagById(id) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const tag = await client_2.prisma.knowledgePresetTag.findFirst({
        where: { id, userId },
    });
    if (!tag)
        return null;
    return (0, dto_1.toPresetTagDto)(tag);
}
async function updatePresetTag(id, input) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const existing = await client_2.prisma.knowledgePresetTag.findFirst({
        where: { id, userId },
    });
    if (!existing)
        return null;
    const tag = await client_2.prisma.knowledgePresetTag.update({
        where: { id, userId },
        data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.color !== undefined ? { color: input.color } : {}),
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            updatedAt: new Date(),
        },
    });
    return (0, dto_1.toPresetTagDto)(tag);
}
async function deletePresetTag(id) {
    const userId = (0, user_context_1.getCurrentUserId)();
    const existing = await client_2.prisma.knowledgePresetTag.findFirst({
        where: { id, userId },
    });
    if (!existing)
        return false;
    await client_2.prisma.knowledgePresetTag.delete({
        where: { id, userId },
    });
    return true;
}
async function getKnowledgeMetadata() {
    const userId = (0, user_context_1.getCurrentUserId)();
    const noteCount = await client_2.prisma.knowledgeNote.count({
        where: { userId },
    });
    const presetTagCount = await client_2.prisma.knowledgePresetTag.count({
        where: { userId },
    });
    return {
        noteCount,
        presetTagCount,
    };
}
