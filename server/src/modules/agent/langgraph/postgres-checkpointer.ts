/**
 * LangGraph PostgreSQL Checkpointer 初始化模块
 *
 * 使用官方 @langchain/langgraph-checkpoint-postgres 提供的 PostgresSaver
 * 自动创建 checkpoints 和 checkpoint_blobs 表
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';

// 创建 Pool（复用现有数据库连接配置）
let pool: Pool | null = null;
let checkpointer: PostgresSaver | null = null;

/**
 * 获取数据库连接池
 */
function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

/**
 * 获取 PostgresSaver 实例（单例）
 */
export function getCheckpointer(): PostgresSaver {
  if (!checkpointer) {
    checkpointer = new PostgresSaver(getPool());
  }
  return checkpointer;
}

/**
 * 初始化 Checkpointer 表（首次运行时调用）
 * 调用 PostgresSaver.setup() 创建 checkpoints 和 checkpoint_blobs 表
 */
export async function initCheckpointer(): Promise<void> {
  const saver = getCheckpointer();
  // setup() 会执行 CREATE TABLE IF NOT EXISTS 语句
  await saver.setup();
}

/**
 * 关闭连接池（应用关闭时调用）
 */
export async function closeCheckpointer(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    checkpointer = null;
  }
}

export { getPool };