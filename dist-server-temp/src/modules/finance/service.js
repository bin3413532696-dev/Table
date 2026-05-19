"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFinanceList = getFinanceList;
exports.createFinanceRecordEntry = createFinanceRecordEntry;
exports.getFinanceRecordDetail = getFinanceRecordDetail;
exports.updateFinanceRecordEntry = updateFinanceRecordEntry;
exports.deleteFinanceRecordEntry = deleteFinanceRecordEntry;
const repository_1 = require("./repository");
const dto_1 = require("./dto");
const conflict_1 = require("../../shared/conflict");
async function getFinanceList() {
    const records = await (0, repository_1.listFinanceRecords)();
    return records.map(dto_1.toFinanceRecordDto);
}
async function createFinanceRecordEntry(input) {
    const record = await (0, repository_1.createFinanceRecord)(input);
    return (0, dto_1.toFinanceRecordDto)(record);
}
async function getFinanceRecordDetail(id) {
    const record = await (0, repository_1.findFinanceRecordById)(id);
    return record ? (0, dto_1.toFinanceRecordDto)(record) : null;
}
async function updateFinanceRecordEntry(id, input) {
    const existing = await (0, repository_1.findFinanceRecordById)(id);
    const record = await (0, repository_1.updateFinanceRecord)(id, input);
    const ensured = (0, conflict_1.ensureMutationResult)(existing, record, 'Finance record was modified by another request. Please refresh and try again.');
    return ensured ? (0, dto_1.toFinanceRecordDto)(ensured) : null;
}
async function deleteFinanceRecordEntry(id) {
    const existing = await (0, repository_1.findFinanceRecordById)(id);
    if (!existing) {
        return null;
    }
    const record = await (0, repository_1.softDeleteFinanceRecord)(id);
    return (0, dto_1.toFinanceRecordDto)(record);
}
