/**
 * Agent UI metadata only.
 *
 * 当前智能体主执行链路已经服务端化，这里只保留面板展示所需的轻量元信息，
 * 避免再把旧前端执行器、旧前端工具体系挂回运行路径。
 */
export const registeredToolNames = [
  'query_finance',
  'get_finance_stats',
  'query_tasks',
  'get_task_stats',
  'search_knowledge',
  'create_task',
  'add_finance_record',
  'update_task',
  'delete_task',
] as const;
