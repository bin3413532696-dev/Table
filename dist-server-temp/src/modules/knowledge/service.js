"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNoteList = getNoteList;
exports.createNoteRecord = createNoteRecord;
exports.getNoteDetail = getNoteDetail;
exports.updateNoteRecord = updateNoteRecord;
exports.deleteNoteRecord = deleteNoteRecord;
exports.searchNoteRecords = searchNoteRecords;
exports.getAllTags = getAllTags;
exports.getPresetTagList = getPresetTagList;
exports.createPresetTagRecord = createPresetTagRecord;
exports.getPresetTagDetail = getPresetTagDetail;
exports.updatePresetTagRecord = updatePresetTagRecord;
exports.deletePresetTagRecord = deletePresetTagRecord;
exports.getKnowledgeOverview = getKnowledgeOverview;
const repository_1 = require("./repository");
async function getNoteList() {
    return (0, repository_1.listNotes)();
}
async function createNoteRecord(input) {
    return (0, repository_1.createNote)(input);
}
async function getNoteDetail(id) {
    return (0, repository_1.findNoteById)(id);
}
async function updateNoteRecord(id, input) {
    return (0, repository_1.updateNote)(id, input);
}
async function deleteNoteRecord(id) {
    return (0, repository_1.deleteNote)(id);
}
async function searchNoteRecords(input) {
    return (0, repository_1.searchNotes)(input);
}
async function getAllTags() {
    return (0, repository_1.listAllTags)();
}
async function getPresetTagList() {
    return (0, repository_1.listPresetTags)();
}
async function createPresetTagRecord(input) {
    return (0, repository_1.createPresetTag)(input);
}
async function getPresetTagDetail(id) {
    return (0, repository_1.findPresetTagById)(id);
}
async function updatePresetTagRecord(id, input) {
    return (0, repository_1.updatePresetTag)(id, input);
}
async function deletePresetTagRecord(id) {
    return (0, repository_1.deletePresetTag)(id);
}
async function getKnowledgeOverview() {
    return (0, repository_1.getKnowledgeMetadata)();
}
