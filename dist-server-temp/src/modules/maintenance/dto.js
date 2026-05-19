"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBusinessSnapshotDto = toBusinessSnapshotDto;
const dto_1 = require("../finance/dto");
const dto_2 = require("../tasks/dto");
function toNoteExportDto(note) {
    return {
        id: note.id,
        title: note.title,
        content: note.content,
        tags: Array.isArray(note.tagsJson)
            ? note.tagsJson.filter((tag) => typeof tag === 'string')
            : [],
        createdAt: note.createdAt.getTime(),
        updatedAt: note.updatedAt.getTime(),
    };
}
function toPresetTagExportDto(tag) {
    return {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        sortOrder: tag.sortOrder,
    };
}
function toBusinessSnapshotDto(input) {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        tasks: input.tasks.map(dto_2.toTaskDto),
        finance: input.finance.map(dto_1.toFinanceRecordDto),
        knowledge: {
            notes: input.notes.map(toNoteExportDto),
            presetTags: input.presetTags.map(toPresetTagExportDto),
        },
    };
}
