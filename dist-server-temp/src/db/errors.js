"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseNotReadyError = void 0;
class DatabaseNotReadyError extends Error {
    constructor(message = 'Database is not configured or reachable') {
        super(message);
        this.name = 'DatabaseNotReadyError';
    }
}
exports.DatabaseNotReadyError = DatabaseNotReadyError;
