-- 为 knowledge_index_jobs 表添加 created_at 列（如果不存在）
-- 修复 Prisma schema 与数据库同步问题

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'knowledge_index_jobs' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE knowledge_index_jobs ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;