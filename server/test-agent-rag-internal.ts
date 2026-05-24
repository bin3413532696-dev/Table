/**
 * Agent RAG 内部流程测试
 * 直接调用 Agent 服务函数，绕过 HTTP 认证
 */
import 'dotenv/config';
import { runWithUserContext } from './src/shared/user-context';
import { prisma } from './src/db/client';

const userId = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('========================================');
  console.log('Agent RAG 内部流程测试');
  console.log('========================================\n');

  // 设置用户上下文
  const userContext = { userId, source: 'default' as const };

  await runWithUserContext(userContext, async () => {
    // 1. 检查知识库状态
    console.log('[1] 知识库状态...');
    const docs = await prisma.$queryRaw<Array<{id: string, title: string, status: string}>>`
      SELECT id, title, status FROM knowledge_documents WHERE user_id = ${userId}::uuid
    `;
    console.log('文档:', docs.length);
    docs.forEach(d => console.log(`  - ${d.id.slice(0,8)} ${d.title} (${d.status})`));

    const chunks = await prisma.$queryRaw<Array<{total: bigint, with_emb: bigint}>>`
      SELECT COUNT(*) as total, COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_emb
      FROM knowledge_chunks WHERE user_id = ${userId}::uuid
    `;
    console.log('Chunks:', Number(chunks[0].total), '有embedding:', Number(chunks[0].with_emb));

    // 2. 测试混合搜索
    console.log('\n[2] 测试混合搜索...');
    const { hybridSearch } = await import('./src/modules/knowledge-rag/retrieval/hybrid-search');

    const searchResult = await hybridSearch({
      query: 'Agent RAG 系统架构',
      mode: 'semantic',
      limit: 5,
      threshold: 0.3
    });
    console.log('搜索结果:', searchResult.results?.length ?? 0);
    if (searchResult.results && searchResult.results.length > 0) {
      console.log('第一个结果:', {
        id: searchResult.results[0].id.slice(0, 8),
        score: searchResult.results[0].score,
        documentTitle: searchResult.results[0].documentTitle,
        contentPreview: searchResult.results[0].content.slice(0, 100)
      });
    }

    // 3. 测试 Agent 工具
    console.log('\n[3] 测试 Agent 工具...');
    const { allTools } = await import('./src/modules/agent/langgraph/tools');

    const semanticSearchTool = allTools.find(t => t.name === 'semantic_search');
    if (semanticSearchTool) {
      console.log('调用 semantic_search 工具...');
      const toolResult = await semanticSearchTool.invoke({
        query: '什么是 RAG 系统的混合检索',
        limit: 3,
        threshold: 0.3
      });
      console.log('工具返回长度:', toolResult.length);
      const chunkCount = (toolResult.match(/<chunk id=/g) || []).length;
      console.log('返回 chunks:', chunkCount);
    }

    // 4. 创建 Agent Session 并运行
    console.log('\n[4] 创建 Agent Session...');
    const session = await prisma.agentSession.create({
      data: {
        userId,
        title: 'RAG 测试会话'
      }
    });
    console.log('Session ID:', session.id.slice(0, 8));

    // 5. 运行 Agent
    console.log('\n[5] 运行 Agent...');
    const { streamAgentRunRecord } = await import('./src/modules/agent/service');

    const query = '请搜索知识库，告诉我 Agent RAG 系统的架构是什么？重点关注混合检索流程。';
    console.log('查询:', query);

    // 收集事件
    const events: any[] = [];
    let finalText = '';
    let toolCalls: any[] = [];
    let status = '';
    let completedRun: any = null;

    // 运行 Agent（流式）
    await streamAgentRunRecord({
      inputText: query,
      model: 'default',
      sessionId: session.id
    }, (event) => {
      events.push(event);
      if (event.type === 'token') {
        process.stdout.write(event.token);
      } else if (event.type === 'run_update') {
        toolCalls = event.run.executedToolCalls || [];
        status = event.run.status;
      } else if (event.type === 'run_completed') {
        finalText = event.run.finalText || '';
        status = event.run.status;
        toolCalls = event.run.executedToolCalls || [];
        completedRun = event.run;
      }
      return Promise.resolve();
    });

    console.log('\n\n========================================');
    console.log('Agent 执行结果');
    console.log('========================================');

    console.log('状态:', status);
    console.log('\n工具调用:');
    for (const tc of toolCalls) {
      console.log(`  - ${tc.toolName}: ${tc.status}`);
      if (tc.toolName === 'semantic_search' || tc.toolName === 'keyword_search') {
        if (tc.result && typeof tc.result === 'object' && tc.result.value) {
          const resultStr = tc.result.value as string;
          const chunkCount = (resultStr.match(/<chunk id=/g) || []).length;
          const maxScoreMatch = resultStr.match(/<max_score>([^<]+)</);
          console.log(`    结果: ${chunkCount} chunks, maxScore=${maxScoreMatch?.[1] || 'N/A'}`);
        }
      }
      if (tc.toolName === 'cite_sources') {
        console.log(`    引用: ${JSON.stringify(tc.result).slice(0, 200)}`);
      }
    }

    console.log('\n最终回答长度:', finalText.length);
    if (finalText.length > 0) {
      console.log('回答预览:', finalText.slice(0, 300));
    }

    // 验证 RAG 引用链路
    const searchTools = toolCalls.filter(tc =>
      tc.toolName === 'semantic_search' || tc.toolName === 'keyword_search' || tc.toolName === 'search_knowledge_rag'
    );
    const citeTools = toolCalls.filter(tc => tc.toolName === 'cite_sources');

    console.log('\n验证结果:');
    console.log(`  搜索工具调用: ${searchTools.length} 次`);
    console.log(`  引用工具调用: ${citeTools.length} 次`);

    if (searchTools.length > 0 && citeTools.length > 0) {
      console.log('  ✓ RAG 引用链路完整');
    } else if (searchTools.length > 0 && citeTools.length === 0) {
      console.log('  ⚠ 使用了搜索但未调用 cite_sources');
      console.log('  可能原因: LLM 未遵循 grounding guardrail 规则');
    } else if (searchTools.length === 0) {
      console.log('  ⚠ 未调用搜索工具');
    }

    // 6. 多轮对话测试
    console.log('\n\n========================================');
    console.log('[6] 多轮对话测试');
    console.log('========================================');

    const query2 = 'Grounding Guardrail 是什么机制？它有什么作用？';
    console.log('第二轮查询:', query2);

    const events2: any[] = [];
    let finalText2 = '';
    let toolCalls2: any[] = [];
    let status2 = '';

    try {
      await streamAgentRunRecord({
        inputText: query2,
        model: 'default',
        sessionId: session.id
      }, (event) => {
        events2.push(event);
        if (event.type === 'token') {
          process.stdout.write(event.token);
        } else if (event.type === 'run_update') {
          toolCalls2 = event.run.executedToolCalls || [];
          status2 = event.run.status;
        } else if (event.type === 'run_completed') {
          finalText2 = event.run.finalText || '';
          toolCalls2 = event.run.executedToolCalls || [];
          status2 = event.run.status;
        }
        return Promise.resolve();
      });

      console.log('\n\n第二轮工具调用:');
      for (const tc of toolCalls2) {
        console.log(`  - ${tc.toolName}: ${tc.status}`);
      }

      console.log('\n第二轮回答长度:', finalText2.length);

    } catch (error: any) {
      console.log('\n第二轮执行错误:', error.message);
    }
  });

  await prisma.$disconnect();
  console.log('\n\n========================================');
  console.log('测试完成');
  console.log('========================================');
}

main().catch(console.error);