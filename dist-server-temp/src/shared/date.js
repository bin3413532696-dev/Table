"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toTimestamp = toTimestamp;
exports.toDateOnly = toDateOnly;
function toTimestamp(value) {
    return value.getTime();
}
function toDateOnly(value) {
    if (!value) {
        return undefined;
    }
    return value.toISOString().slice(0, 10);
}
