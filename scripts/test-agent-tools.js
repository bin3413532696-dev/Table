/* eslint-disable no-console */
require('dotenv').config();

const { runWithUserContext, getDefaultUserId } = require('../dist-server/src/shared/user-context');
const {
  queryTasksTool,
  getTaskStatsTool,
  queryFinanceTool,
  getFinanceStatsTool,
  searchKnowledgeTool,
  createTaskTool,
  addFinanceRecordTool,
  updateTaskTool,
  deleteTaskTool,
} = require('../dist-server/src/modules/agent/langgraph/tools');
const { deleteFinanceRecordEntry } = require('../dist-server/src/modules/finance/service');

function toIsoDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const userId = getDefaultUserId();

  await runWithUserContext({ userId, source: 'default' }, async () => {
    const results = [];
    const cleanup = [];

    try {
      const createdTask = await createTaskTool.invoke({
        title: `agent tool test ${Date.now()}`,
        priority: '高',
      });
      results.push(['create_task', createdTask]);
      const queriedTasks = await queryTasksTool.invoke({
        priority: '高',
        limit: 5,
      });
      results.push(['query_tasks', queriedTasks]);

      const updatedTask = await updateTaskTool.invoke({
        id: createdTask.id,
        title: `${createdTask.title} updated`,
        priority: '中',
        completed: false,
      });
      results.push(['update_task', updatedTask]);

      const taskStats = await getTaskStatsTool.invoke({});
      results.push(['get_task_stats', taskStats]);

      const financeRecord = await addFinanceRecordTool.invoke({
        type: 'expense',
        amount: 12.5,
        description: `agent tool test ${Date.now()}`,
        category: 'test',
        date: toIsoDateOnly(new Date()),
      });
      results.push(['add_finance_record', financeRecord]);
      cleanup.push(async () => {
        await deleteFinanceRecordEntry(financeRecord.id);
      });

      const queriedFinance = await queryFinanceTool.invoke({
        type: 'expense',
        category: 'test',
        limit: 5,
      });
      results.push(['query_finance', queriedFinance]);

      const financeStats = await getFinanceStatsTool.invoke({});
      results.push(['get_finance_stats', financeStats]);

      const knowledgeResults = await searchKnowledgeTool.invoke({
        query: 'test',
        limit: 3,
      });
      results.push(['search_knowledge', knowledgeResults]);

      const deletedTask = await deleteTaskTool.invoke({
        id: createdTask.id,
      });
      results.push(['delete_task', deletedTask]);

      for (const [name, result] of results) {
        console.log(`=== ${name} ===`);
        console.log(JSON.stringify(result, null, 2));
      }
    } finally {
      for (const fn of cleanup.reverse()) {
        try {
          await fn();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('未找到任务')) {
            console.error('cleanup failed:', error);
          }
        }
      }
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
