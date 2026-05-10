import type { FinanceRecord, KnowledgeNote, KnowledgePresetTag, Task } from '@prisma/client';
import { toFinanceRecordDto } from '../finance/dto';
import { toTaskDto } from '../tasks/dto';

function toNoteExportDto(note: KnowledgeNote) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    tags: Array.isArray(note.tagsJson)
      ? note.tagsJson.filter((tag): tag is string => typeof tag === 'string')
      : [],
    createdAt: note.createdAt.getTime(),
    updatedAt: note.updatedAt.getTime(),
  };
}

function toPresetTagExportDto(tag: KnowledgePresetTag) {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    sortOrder: tag.sortOrder,
  };
}

export type BusinessSnapshotDto = {
  version: number;
  exportedAt: string;
  tasks: ReturnType<typeof toTaskDto>[];
  finance: ReturnType<typeof toFinanceRecordDto>[];
  knowledge: {
    notes: ReturnType<typeof toNoteExportDto>[];
    presetTags: ReturnType<typeof toPresetTagExportDto>[];
  };
};

export function toBusinessSnapshotDto(input: {
  tasks: Task[];
  finance: FinanceRecord[];
  notes: KnowledgeNote[];
  presetTags: KnowledgePresetTag[];
}): BusinessSnapshotDto {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: input.tasks.map(toTaskDto),
    finance: input.finance.map(toFinanceRecordDto),
    knowledge: {
      notes: input.notes.map(toNoteExportDto),
      presetTags: input.presetTags.map(toPresetTagExportDto),
    },
  };
}
