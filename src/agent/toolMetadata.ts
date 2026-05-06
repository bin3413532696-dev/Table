/**
 * Agent UI metadata only.
 *
 * 当前智能体主执行链路已经服务端化，这里只保留面板展示所需的轻量元信息，
 * 避免再把旧前端执行器、旧前端工具体系挂回运行路径。
 */
export const registeredToolNames = [
  'query_finance',
  'get_finance_stats',
  'add_finance_record',
  'delete_finance_record',
  'query_tasks',
  'get_task_stats',
  'create_task',
  'update_task',
  'delete_task',
  'get_overview',
  'cross_module_analysis',
  'get_knowledge_overview',
  'search_knowledge',
  'get_knowledge_entity',
  'upsert_knowledge_entity',
  'create_knowledge_relation',
  'upsert_knowledge_document',
  'upsert_knowledge_assertion',
  'delete_knowledge_entity',
  'delete_knowledge_document',
  'delete_knowledge_assertion',
  'delete_knowledge_relation',
  'calculate_expression',
  'parse_color',
  'format_json',
  'get_settings_overview',
  'update_profile',
  'set_theme',
  'http_request',
  'manage_api_config',
  'get_weather',
  'get_current_time',
] as const;
