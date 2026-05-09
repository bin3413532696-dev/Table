import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __tablePrisma__: PrismaClient | undefined;
}

const prismaOptions: { log: Array<'error' | 'warn'> } = {
  log: ['error', 'warn'],
};

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !databaseUrl.includes('connection_limit')) {
  process.env.DATABASE_URL = databaseUrl + '?connection_limit=20&pool_timeout=10';
}

export const prisma =
  globalThis.__tablePrisma__ ??
  new PrismaClient(prismaOptions);

if (process.env.NODE_ENV !== 'production') {
  globalThis.__tablePrisma__ = prisma;
}
