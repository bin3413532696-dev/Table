-- 为 KnowledgeDocument 添加结构化元数据字段
-- 发布日期、来源部门、保密等级、业务分类、文档语言
-- 解析质量指标

-- 1. 添加结构化元数据字段
ALTER TABLE knowledge_documents ADD COLUMN publish_date DATE;
ALTER TABLE knowledge_documents ADD COLUMN source_dept VARCHAR(100);
ALTER TABLE knowledge_documents ADD COLUMN security_level VARCHAR(50);
ALTER TABLE knowledge_documents ADD COLUMN business_category VARCHAR(100);
ALTER TABLE knowledge_documents ADD COLUMN doc_language VARCHAR(10) DEFAULT 'zh';

-- 2. 添加解析质量字段
ALTER TABLE knowledge_documents ADD COLUMN parse_quality VARCHAR(20);
ALTER TABLE knowledge_documents ADD COLUMN has_ocr BOOLEAN DEFAULT FALSE;
ALTER TABLE knowledge_documents ADD COLUMN original_metadata JSONB;

-- 3. 创建索引以支持高效过滤
CREATE INDEX knowledge_documents_publish_date_idx ON knowledge_documents (user_id, publish_date DESC);
CREATE INDEX knowledge_documents_source_dept_idx ON knowledge_documents (user_id, source_dept);
CREATE INDEX knowledge_documents_security_level_idx ON knowledge_documents (user_id, security_level);
CREATE INDEX knowledge_documents_business_category_idx ON knowledge_documents (user_id, business_category);

-- 4. 创建组合索引（日期+部门）用于常见查询场景
CREATE INDEX knowledge_documents_date_dept_idx ON knowledge_documents (user_id, publish_date DESC, source_dept);