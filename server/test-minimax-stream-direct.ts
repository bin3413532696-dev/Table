/**
 * 直接测试 MiniMax 流式 API 的 Function Calling
 */
import 'dotenv/config';
import { decryptProviderSecret } from './src/shared/crypto';
import { prisma } from './src/db/client';

const userId = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('========================================');
  console.log('MiniMax 流式 API 直接测试');
  console.log('========================================\n');

  const provider = await prisma.$queryRaw<Array<{
    base_url: string;
    api_key_encrypted: string;
    model: string;
  }>>`
    SELECT base_url, api_key_encrypted, model
    FROM api_providers
    WHERE user_id = ${userId}::uuid AND is_active = true
    LIMIT 1
  `;

  if (!provider[0]) {
    console.log('未找到 Provider');
    return;
  }

  const apiKey = decryptProviderSecret(provider[0].api_key_encrypted || '');
  const baseUrl = provider[0].base_url;
  const model = provider[0].model;

  console.log('Provider:', { baseUrl, model });

  // 测试流式 + Function Calling
  console.log('\n[1] 流式 + Function Calling...');
  const tools = [
    {
      type: 'function',
      function: {
        name: 'semantic_search',
        description: '通过语义相似度搜索知识库',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索查询' },
            limit: { type: 'integer', default: 5 }
          },
          required: ['query']
        }
      }
    }
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是助手，必须使用 semantic_search 工具搜索知识库。' },
        { role: 'user', content: '请搜索知识库中关于 Agent RAG 系统架构的信息' }
      ],
      tools,
      stream: true
    })
  });

  console.log('响应状态:', response.status);
  console.log('响应 Headers:', Object.fromEntries(response.headers.entries()));

  const reader = response.body?.getReader();
  if (!reader) {
    console.log('无法获取流');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let contentChunks: string[] = [];
  let toolCallChunks: any[] = [];

  console.log('\n接收流数据...');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;

          if (delta?.content) {
            contentChunks.push(delta.content);
            console.log('Content chunk:', delta.content.slice(0, 50));
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              toolCallChunks.push(tc);
              console.log('Tool call chunk:', JSON.stringify(tc));
            }
          }
        } catch (e) {
          // 可能是不完整的 JSON
          buffer = line;
        }
      }
    }
  }

  console.log('\n========================================');
  console.log('流处理结果');
  console.log('========================================');
  console.log('内容:', contentChunks.join('').slice(0, 200) || '无内容');
  console.log('工具调用 chunks:', toolCallChunks.length);

  // 解析工具调用 chunks
  const aggregatedToolCalls: Record<number, { id: string; name: string; arguments: string }> = {};
  for (const tc of toolCallChunks) {
    const index = tc.index ?? 0;
    if (!aggregatedToolCalls[index]) {
      aggregatedToolCalls[index] = { id: tc.id || '', name: '', arguments: '' };
    }
    if (tc.function?.name) {
      aggregatedToolCalls[index].name = tc.function.name;
    }
    if (tc.function?.arguments) {
      aggregatedToolCalls[index].arguments += tc.function.arguments;
    }
  }

  console.log('\n聚合的工具调用:');
  for (const [index, tc] of Object.entries(aggregatedToolCalls)) {
    console.log(`  [${index}]`, tc.name, tc.arguments.slice(0, 100));
    try {
      const args = JSON.parse(tc.arguments);
      console.log('    参数:', JSON.stringify(args));
    } catch {
      console.log('    参数解析失败');
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);