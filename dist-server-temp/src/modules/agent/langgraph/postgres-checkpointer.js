"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCheckpointer = getCheckpointer;
exports.initCheckpointer = initCheckpointer;
exports.closeCheckpointer = closeCheckpointer;
exports.getPool = getPool;
/**
 * LangGraph PostgreSQL Checkpointer 初始化模块
 *
 * 使用官方 @langchain/langgraph-checkpoint-postgres 提供的 PostgresSaver
 * 自动创建 checkpoints 和 checkpoint_blobs 表
 */
const langgraph_checkpoint_postgres_1 = require("@langchain/langgraph-checkpoint-postgres");
const pg_1 = require("pg");
// 创建 Pool（复用现有数据库连接配置）
let pool = null;
let checkpointer = null;
/**
 * 获取数据库连接池
 */
function getPool() {
    if (!pool) {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error('DATABASE_URL environment variable is not set');
        }
        pool = new pg_1.Pool({
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
function getCheckpointer() {
    if (!checkpointer) {
        checkpointer = new langgraph_checkpoint_postgres_1.PostgresSaver(getPool());
    }
    return checkpointer;
}
/**
 * 初始化 Checkpointer 表（首次运行时调用）
 * 调用 PostgresSaver.setup() 创建 checkpoints 和 checkpoint_blobs 表
 */
async function initCheckpointer() {
    const saver = getCheckpointer();
    // setup() 会执行 CREATE TABLE IF NOT EXISTS 语句
    await saver.setup();
}
/**
 * 关闭连接池（应用关闭时调用）
 */
async function closeCheckpointer() {
    if (pool) {
        await pool.end();
        pool = null;
        checkpointer = null;
    }
}
