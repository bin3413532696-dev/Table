"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVersionConflictError = createVersionConflictError;
exports.ensureMutationResult = ensureMutationResult;
function createVersionConflictError(message) {
    return Object.assign(new Error(message), {
        statusCode: 409,
        code: 'VERSION_CONFLICT',
    });
}
function ensureMutationResult(existing, result, message) {
    if (!existing) {
        return null;
    }
    if (!result) {
        throw createVersionConflictError(message);
    }
    return result;
}
