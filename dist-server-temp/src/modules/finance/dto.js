"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toFinanceRecordDto = toFinanceRecordDto;
const date_1 = require("../../shared/date");
function toFinanceRecordDto(record) {
    return {
        id: record.id,
        type: record.type,
        amount: Number(record.amount),
        description: record.description,
        category: record.category,
        date: (0, date_1.toDateOnly)(record.recordDate),
        model: record.model ?? undefined,
        createdAt: (0, date_1.toTimestamp)(record.createdAt),
        updatedAt: (0, date_1.toTimestamp)(record.updatedAt),
        version: record.version,
    };
}
