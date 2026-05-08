import type { KnowledgeNote, KnowledgePresetTag } from '@prisma/client';

function toTimestamp(value: Date): number {
  return value.getTime();
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function toNoteDto(note: KnowledgeNote) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    tags: toStringArray(note.tagsJson),
    createdAt: toTimestamp(note.createdAt),
    updatedAt: toTimestamp(note.updatedAt),
  };
}

export function toPresetTagDto(tag: KnowledgePresetTag) {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    sortOrder: tag.sortOrder,
  };
}
