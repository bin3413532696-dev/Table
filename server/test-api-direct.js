/**
 * 直接测试 MiniMax/自定义 API 的 Function Calling 支持
 */
require('dotenv').config({ path: '../.env' });

const BASE_URL = process.env.DEFAULT_PROVIDER_BASE_URL;
const API_KEY = process.env.DEFAULT_PROVIDER_API_KEY;
const MODEL = process.env.DEFAULT_PROVIDER_MODEL;

async function testFunctionCall() {
  console.log('=== 测试 Function Calling 支持 ===\n');
  console.log('BASE_URL:', BASE_URL);
  console.log('API_KEY:', API_KEY);
  console.log('MODEL:', MODEL);

  // 测试请求
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你是助手，必须使用工具回答问题。当用户请求查询知识库时，必须调用 semantic_search 工具。' },
        { role: 'user', content: 'RAG检索知识库，介绍下GPT' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'semantic_search',
            description: '语义搜索知识库文档',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '搜索查询' },
              },
              required: ['query'],
            },
          },
        },
      ],
      tool_choice: 'auto',
    }),
  });

  console.log('\n响应状态:', response.status);

  if (!response.ok) {
    console.error('请求失败:', await response.text());
    return;
  }

  const data = await response.json();
  console.log('\n完整响应:');
  console.log(JSON.stringify(data, null, 2));

  // 分析响应
  const choice = data.choices?.[0];
  if (choice) {
    console.log('\nfinish_reason:', choice.finish_reason);
    console.log('message.role:', choice.message?.role);
    console.log('message.content:', choice.message?.content);
    console.log('message.tool_calls:', choice.message?.tool_calls);
  }
}

testFunctionCall().catch(console.error);