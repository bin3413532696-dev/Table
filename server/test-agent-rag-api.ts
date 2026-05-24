/**
 * Agent RAG 完整 API 测试
 * 模拟前端发起 Agent 对话请求
 */
import 'dotenv/config';

const API_BASE = 'http://localhost:8787/api';

async function main() {
  console.log('========================================');
  console.log('Agent RAG API 完整测试');
  console.log('========================================\n');

  // 1. 检查 Provider 配置
  console.log('[1] 检查 Provider...');
  const providerRes = await fetch(`${API_BASE}/providers/active`);
  const provider = await providerRes.json();
  console.log('Provider:', {
    name: provider.name,
    model: provider.model,
    embeddingModel: provider.embeddingModel,
  });

  // 2. 检查知识库文档
  console.log('\n[2] 检查知识库文档...');
  const docsRes = await fetch(`${API_BASE}/knowledge-rag/documents?limit=10`);
  const docsData = await docsRes.json();
  console.log('文档数量:', docsData.total);
  console.log('文档列表:', docsData.items.map(d => ({ id: d.id.slice(0, 8), title: d.title, status: d.status })));

  // 3. 检查 Chunks 状态
  console.log('\n[3] 检查 Chunks...');
  const chunksRes = await fetch(`${API_BASE}/knowledge-rag/chunks?limit=20`);
  const chunksData = await chunksRes.json();
  console.log('Chunks 数量:', chunksData.total);

  // 4. 测试 RAG 搜索 API
  console.log('\n[4] 测试 RAG 搜索 API...');
  const searchRes = await fetch(`${API_BASE}/knowledge-rag/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'Agent RAG 系统架构',
      mode: 'hybrid',
      limit: 5,
      threshold: 0.2,
    }),
  });
  const searchData = await searchRes.json();
  console.log('搜索结果数量:', searchData.results?.length ?? 0);
  if (searchData.results?.length > 0) {
    console.log('第一个结果:', {
      id: searchData.results[0].id.slice(0, 8),
      score: searchData.results[0].score,
      title: searchData.results[0].documentTitle,
      preview: searchData.results[0].content.slice(0, 80),
    });
  } else {
    console.log('搜索错误:', searchData.error || searchData.message || '无结果');
  }

  // 5. 测试 Agent 运行时状态
  console.log('\n[5] 测试 Agent 运行时...');
  const agentStatusRes = await fetch(`${API_BASE}/agent/providers/active`);
  const agentStatus = await agentStatusRes.json();
  console.log('Agent Provider:', agentStatus);

  // 6. 创建 Agent Session 并发送 RAG 查询
  console.log('\n[6] 创建 Agent 会话并发送 RAG 查询...');
  console.log('查询: "请搜索知识库告诉我 Agent RAG 系统的架构是什么"');

  // 先创建 session
  const sessionRes = await fetch(`${API_BASE}/agent/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'RAG 测试会话' }),
  });
  const session = await sessionRes.json();
  console.log('Session ID:', session.id.slice(0, 8));

  // 创建 run（使用 SSE 流）
  const runRes = await fetch(`${API_BASE}/agent/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputText: '请搜索知识库告诉我 Agent RAG 系统的架构是什么',
      model: 'default',
      sessionId: session.id,
    }),
  });

  if (!runRes.ok) {
    const errorText = await runRes.text();
    console.log('Agent Run 失败:', runRes.status, errorText);
    return;
  }

  // 处理 SSE 流
  const reader = runRes.body?.getReader();
  if (!reader) {
    console.log('无法获取响应流');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let toolCalls: any[] = [];
  let finalText = '';
  let runId = '';
  let status = '';

  console.log('\n接收 Agent 响应...\n');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (!data.trim()) continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'metadata') {
              runId = event.runId;
              console.log('Run ID:', runId.slice(0, 8));
            } else if (event.type === 'token') {
              process.stdout.write(event.token);
            } else if (event.type === 'run_update') {
              toolCalls = event.run.executedToolCalls || [];
              status = event.run.status;
            } else if (event.type === 'run_completed') {
              finalText = event.run.finalText || '';
              status = event.run.status;
              toolCalls = event.run.executedToolCalls || [];
            }
          } catch {
            buffer = line;
          }
        }
      }
    }
  } catch (e) {
    console.log('\n流读取错误:', e);
  }

  console.log('\n\n========================================');
  console.log('Agent 执行结果');
  console.log('========================================');
  console.log('状态:', status);
  console.log('\n工具调用:');
  for (const tc of toolCalls) {
    console.log(`  - ${tc.name}: ${tc.success ? '成功' : '失败'}`);
    if (tc.name === 'semantic_search' || tc.name === 'keyword_search') {
      if (typeof tc.result === 'string') {
        const chunkCount = (tc.result.match(/<chunk id=/g) || []).length;
        const maxScoreMatch = tc.result.match(/<max_score>([^<]+)</);
        console.log(`    结果: ${chunkCount} chunks, maxScore=${maxScoreMatch?.[1] || 'N/A'}`);
      }
    }
    if (tc.name === 'cite_sources') {
      console.log(`    引用: ${JSON.stringify(tc.result)}`);
    }
  }

  console.log('\n最终回答长度:', finalText.length);
  if (finalText.length > 0) {
    console.log('回答预览:', finalText.slice(0, 200));
  }

  // 验证 RAG 引用链路
  const searchTools = toolCalls.filter(tc =>
    tc.name === 'semantic_search' || tc.name === 'keyword_search' || tc.name === 'search_knowledge_rag'
  );
  const citeTools = toolCalls.filter(tc => tc.name === 'cite_sources');

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

  console.log('\n========================================');
  console.log('测试完成');
  console.log('========================================');
}

main().catch(console.error);