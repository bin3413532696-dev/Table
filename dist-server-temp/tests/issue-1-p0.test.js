"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const zod_1 = require("zod");
const schema_1 = require("../src/modules/finance/schema");
const schema_2 = require("../src/modules/tasks/schema");
const conflict_1 = require("../src/shared/conflict");
(0, node_test_1.default)('finance update schema requires version', () => {
    strict_1.default.throws(() => schema_1.updateFinanceRecordSchema.parse({ amount: 10 }), (error) => error instanceof zod_1.ZodError && error.issues.some((issue) => issue.path.join('.') === 'version'));
    const payload = schema_1.updateFinanceRecordSchema.parse({ amount: 10, version: 1 });
    strict_1.default.equal(payload.version, 1);
});
(0, node_test_1.default)('task update schema requires version', () => {
    strict_1.default.throws(() => schema_2.updateTaskSchema.parse({ completed: true }), (error) => error instanceof zod_1.ZodError && error.issues.some((issue) => issue.path.join('.') === 'version'));
    const payload = schema_2.updateTaskSchema.parse({ completed: true, version: 2 });
    strict_1.default.equal(payload.version, 2);
});
(0, node_test_1.default)('ensureMutationResult returns null when entity does not exist', () => {
    const result = (0, conflict_1.ensureMutationResult)(null, null, 'conflict');
    strict_1.default.equal(result, null);
});
(0, node_test_1.default)('ensureMutationResult throws a 409-style error when mutation lost the race', () => {
    strict_1.default.throws(() => (0, conflict_1.ensureMutationResult)({ id: 'exists' }, null, 'race detected'), (error) => error instanceof Error &&
        'statusCode' in error &&
        error.statusCode === 409 &&
        error.message === 'race detected');
});
(0, node_test_1.default)('ensureMutationResult returns repository result when mutation succeeds', () => {
    const updated = { id: 'updated', version: 2 };
    const result = (0, conflict_1.ensureMutationResult)({ id: 'existing', version: 1 }, updated, 'conflict');
    strict_1.default.deepEqual(result, updated);
});
