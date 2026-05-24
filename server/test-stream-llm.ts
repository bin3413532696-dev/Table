/**
 * 调试 LangChain invoke 的 tool_calls 解析
 */
import 'dotenv/config';
import { decryptProviderSecret } from './src/shared/crypto';
import { prisma } from './src/db/client';
import { createChatModelWithTools } from './src/modules/agent/langgraph/chatModel';
import { allTools } from './src/modules/agent/langgraph/tools';
import { parseToolCalls, parseToolCallsFromResponse } from './src/modules/agent/langgraph/parser';
import { SYSTEM_PROMPT } from './src/modules/agent/langgraph/prompts';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ProviderConfig } from './src/modules/agent/langgraph/state';

const userId = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('========================================');
  console.log('LangChain invoke tool_calls 调试');
  console.log('========================================\n');

  // 获取 provider
  const provider = await prisma.$queryRaw<Array<{
    id: string;
    base_url: string;
    api_key_encrypted: string;
    model: string;
    api_format: string;
    headers_json: any;
  }>>`
    SELECT id, base_url, api_key_encrypted, model, api_format, headers_json
    FROM api_providers
    WHERE user_id = ${userId}::uuid AND is_active = true
    LIMIT 1
  `;

  if (!provider[0]) {
    console.log('未找到 Provider');
    return;
  }

  const apiKey = decryptProviderSecret(provider[0].api_key_encrypted || '');
  const providerConfig: ProviderConfig = {
    id: provider[0].id,
    name: 'test',
    apiFormat: provider[0].api_format,
    baseUrl: provider[0].base_url,
    apiKey,
    model: provider[0].model,
    headers: provider[0].headers_json || {},
  };

  const model = provider[0].model;
  console.log('Provider:', { baseUrl: providerConfig.baseUrl, model, apiFormat: providerConfig.apiFormat });

  // 调用 LangChain invoke
  console.log('\n[1] LangChain invoke...');
  const chatModel = createChatModelWithTools(providerConfig, model, allTools);

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage('请搜索知识库，告诉我 Agent RAG 系统的架构是什么？')
  ];

  const response = await chatModel.invoke(messages);

  console.log('\nLangChain 响应:');
  console.log('  content type:', typeof response.content);
  console.log('  content length:', typeof response.content === 'string' ? response.content.length : JSON.stringify(response.content).length);
  console.log('  content preview:', typeof response.content === 'string' ? response.content.slice(0, 200) : JSON.stringify(response.content).slice(0, 200));
  console.log('  tool_calls:', response.tool_calls?.length ?? 0);
  if (response.tool_calls && response.tool_calls.length > 0) {
    for (const tc of response.tool_calls) {
      console.log('    -', tc.name, JSON.stringify(tc.args));
    }
  }
  console.log('  additional_kwargs:', JSON.stringify(response.additional_kwargs ?? {}).slice(0, 300));

  // 使用 parseToolCallsFromResponse 解析
  console.log('\n[2] parseToolCallsFromResponse...');
  const parsedToolCalls = parseToolCallsFromResponse(response);
  console.log('解析到的工具调用:', parsedToolCalls.length);
  for (const tc of parsedToolCalls) {
    console.log('  -', tc.name, JSON.stringify(tc.arguments));
  }

  // 从文本解析
  console.log('\n[3] parseToolCalls from content...');
  const content = typeof response.content === 'string' ? response.content : '';
  const { toolCalls } = parseToolCalls(content);
  console.log('文本解析工具调用:', toolCalls.length);
  for (const tc of toolCalls) {
    console.log('  -', tc.name, JSON.stringify(tc.arguments));
  }

  await prisma.$disconnect();
}

main().catch(console.error);