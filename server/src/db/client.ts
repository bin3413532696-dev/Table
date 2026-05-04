import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __tablePrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__tablePrisma__ ??
  new PrismaClient({
    log: ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__tablePrisma__ = prisma;
}
