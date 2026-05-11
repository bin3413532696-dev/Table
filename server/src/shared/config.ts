import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

// Zod 的 z.coerce.boolean() 对 "false" 字符串返回 true（因为 Boolean("false") === true）
// 使用预处理来正确解析环境变量中的 boolean
const booleanSchema = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      return val === 'true' || val === '1';
    }
    return Boolean(val);
  },
  z.boolean()
);

const envSchema = z.object({
  SERVER_HOST: z.string().default('127.0.0.1'),
  SERVER_PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@127.0.0.1:5432/table_dev'),
  ALLOW_DEFAULT_USER_FALLBACK: booleanSchema.default(false),
  TRUST_USER_ID_HEADER: booleanSchema.default(false),
  DEFAULT_USER_ID: z.string().uuid().default('00000000-0000-0000-0000-000000000001'),
  PROVIDER_SECRET_KEY: z.string().min(16).default('table-dev-provider-secret-key-change-me'),
  DEFAULT_PROVIDER_NAME: z.string().default('GLM-5 Provider'),
  DEFAULT_PROVIDER_FORMAT: z.enum(['anthropic', 'openai', 'gemini', 'custom']).default('openai'),
  DEFAULT_PROVIDER_BASE_URL: z.string().default(''),
  DEFAULT_PROVIDER_API_KEY: z.string().default(''),
  DEFAULT_PROVIDER_MODEL: z.string().default(''),
  PROJECTION_OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1500),
  PROJECTION_OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(20),
});

export type ServerConfig = z.infer<typeof envSchema>;

export function loadServerConfig(): ServerConfig {
  const config = envSchema.parse(process.env);

  if (config.PROVIDER_SECRET_KEY === 'table-dev-provider-secret-key-change-me') {
    if (process.env.NODE_ENV === 'production') {
      console.error('[SECURITY] FATAL: PROVIDER_SECRET_KEY is using the default value in production. Refusing to start.');
      process.exit(1);
    }
    console.error('[SECURITY] PROVIDER_SECRET_KEY is using the default value. Set a strong secret before deploying to production.');
  }

  if (config.ALLOW_DEFAULT_USER_FALLBACK && config.DEFAULT_USER_ID === '00000000-0000-0000-0000-000000000001') {
    if (process.env.NODE_ENV === 'production') {
      console.error('[SECURITY] FATAL: DEFAULT_USER_ID is using the publicly known default UUID with fallback enabled in production. Refusing to start.');
      process.exit(1);
    }
    console.error('[SECURITY] DEFAULT_USER_ID is using the publicly known default UUID with fallback enabled. This is insecure for production.');
  }

  return config;
}
