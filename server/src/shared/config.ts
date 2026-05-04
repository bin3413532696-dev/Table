import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  SERVER_HOST: z.string().default('127.0.0.1'),
  SERVER_PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@127.0.0.1:5432/table_dev'),
  PROJECTION_OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1500),
  PROJECTION_OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(20),
});

export type ServerConfig = z.infer<typeof envSchema>;

export function loadServerConfig(): ServerConfig {
  return envSchema.parse(process.env);
}
