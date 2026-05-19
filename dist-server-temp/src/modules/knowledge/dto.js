"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toNoteDto = toNoteDto;
exports.toPresetTagDto = toPresetTagDto;
function toTimestamp(value) {
    return value.getTime();
}
function toStringArray(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string')
        : [];
}
function toNoteDto(note) {
    return {
        id: note.id,
        title: note.title,
        content: note.content,
        tags: toStringArray(note.tagsJson),
        createdAt: toTimestamp(note.createdAt),
        updatedAt: toTimestamp(note.updatedAt),
    };
}
function toPresetTagDto(tag) {
    return {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        sortOrder: tag.sortOrder,
    };
}
