/**
 * 测试 MiniMax Function Calling 支持
 */
import 'dotenv/config';
import { decryptProviderSecret } from './src/shared/crypto';
import { prisma } from './src/db/client';

const userId = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000001';

async function testMiniMaxFunctionCalling() {
  console.log('========================================');
  console.log('MiniMax Function Calling 测试');
  console.log('========================================\n');

  // 获取 provider
  const provider = await prisma.$queryRaw<Array<{
    base_url: string;
    api_key_encrypted: string;
    model: string;
    api_format: string;
  }>>`
    SELECT base_url, api_key_encrypted, model, api_format
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

  console.log('Provider:', { baseUrl, model, apiFormat: provider[0].api_format });

  // 测试 1: 带 tools 参数的请求
  console.log('\n[1] 测试 Function Calling...');
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
        { role: 'system', content: '你是助手，可以使用 semantic_search 工具搜索知识库。当用户询问时，必须调用工具。' },
        { role: 'user', content: '请搜索知识库中关于 Agent RAG 系统架构的信息' }
      ],
      tools,
      tool_choice: 'auto'
    })
  });

  const data = await response.json();
  console.log('响应状态:', response.status);

  if (data.error) {
    console.log('错误:', data.error);
  } else {
    console.log('\n消息内容:', data.choices?.[0]?.message?.content?.slice(0, 200) || '无内容');
    console.log('工具调用:', JSON.stringify(data.choices?.[0]?.message?.tool_calls ?? null, null, 2));
  }

  // 测试 2: 使用 tool_choice: required
  console.log('\n[2] 测试 tool_choice: required...');
  const response2 = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是助手，必须使用 semantic_search 工具搜索知识库。当用户询问信息时，必须调用此工具。' },
        { role: 'user', content: '请搜索知识库中关于 Agent RAG 系统架构的信息' }
      ],
      tools,
      tool_choice: 'required'
    })
  });

  const data2 = await response2.json();
  console.log('响应状态:', response2.status);

  if (data2.error) {
    console.log('错误:', data2.error);
  } else {
    console.log('\n消息内容:', data2.choices?.[0]?.message?.content?.slice(0, 200) || '无内容');
    console.log('工具调用:', JSON.stringify(data2.choices?.[0]?.message?.tool_calls ?? null, null, 2));
    console.log('完整响应 choices[0]:', JSON.stringify(data2.choices?.[0] ?? null, null, 2).slice(0, 500));
  }

  // 测试 3: 纯文本格式（不使用 tools 参数）
  console.log('\n[3] 测试纯文本格式...');
  const textFormatPrompt = `你是助手，可以使用以下工具：
- semantic_search(query!, limit?) - 语义搜索知识库

工具调用格式（使用 tool 代码块）：
` + '```tool' + `
{"name": "semantic_search", "arguments": {"query": "搜索内容"}}
` + '```' + `

用户询问时，必须先调用工具，然后等待结果后再回答。`;

  const response3 = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: textFormatPrompt },
        { role: 'user', content: '请搜索知识库中关于 Agent RAG 系统架构的信息' }
      ]
    })
  });

  const data3 = await response3.json();
  console.log('响应状态:', response3.status);

  if (data3.error) {
    console.log('错误:', data3.error);
  } else {
    const content = data3.choices?.[0]?.message?.content || '';
    console.log('\n完整响应:');
    console.log(content);
    console.log('\n包含 tool 代码块:', content.includes('```tool'));
    console.log('包含 JSON 代码块:', content.includes('```json'));
  }

  await prisma.$disconnect();
  console.log('\n========================================');
  console.log('测试完成');
  console.log('========================================');
}

testMiniMaxFunctionCalling().catch(console.error);