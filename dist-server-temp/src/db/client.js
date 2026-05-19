"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const prismaOptions = {
    log: ['error', 'warn'],
};
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !databaseUrl.includes('connection_limit')) {
    process.env.DATABASE_URL = databaseUrl + '?connection_limit=20&pool_timeout=10';
}
exports.prisma = globalThis.__tablePrisma__ ??
    new client_1.PrismaClient(prismaOptions);
if (process.env.NODE_ENV !== 'production') {
    globalThis.__tablePrisma__ = exports.prisma;
}
