/**
 * Agent RAG 真实请求测试 - 直接调用 MiniMax API
 */
import 'dotenv/config';

const SERVER_URL = 'http://127.0.0.1:8787';
const MINIMAX_API_KEY = process.env.DEFAULT_PROVIDER_API_KEY || '';
const MINIMAX_BASE_URL = process.env.DEFAULT_PROVIDER_BASE_URL || 'https://zyapi.tuluo.top:8888/v1';

async function testMiniMaxDirect() {
  console.log('=== MiniMax API 直接测试（Function Call）===\n');

  // 直接用 OpenAI-compatible 接口调用 MiniMax
  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      messages: [
        { role: 'system', content: '你是助手，必须使用工具回答问题。' },
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

  if (!response.ok) {
    console.error('请求失败:', response.status, await response.text());
    return;
  }

  const data = await response.json() as any;
  console.log('完整响应:', JSON.stringify(data, null, 2));
  console.log('\nfinish_reason:', data.choices?.[0]?.finish_reason);
  console.log('tool_calls:', data.choices?.[0]?.message?.tool_calls);
  console.log('content:', data.choices?.[0]?.message?.content);
}

async function testAgentViaServer() {
  console.log('=== Agent RAG 服务器测试 ===\n');

  // 1. 获取 CSRF Token
  const csrfRes = await fetch(`${SERVER_URL}/api/auth/pin`);
  const csrfCookie = csrfRes.headers.get('set-cookie') || '';
  const csrfToken = csrfCookie.match(/table_dev_csrf_token=([^;]+)/)?.[1] || '';
  let sessionCookie = `table_dev_csrf_token=${csrfToken}`;

  if (!csrfToken) {
    console.error('❌ 无法获取 CSRF Token');
    return;
  }

  // 2. 创建用户
  const createUserRes = await fetch(`${SERVER_URL}/api/auth/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cookie': sessionCookie,
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ displayName: 'Test' }),
  });
  const newUser = await createUserRes.json() as any;
  console.log('用户:', newUser.id);

  // 获取 session cookie
  const setCookie = createUserRes.headers.get('set-cookie') || '';
  const sessionIdMatch = setCookie.match(/table_dev_session_user_id=([^;]+)/);
  if (sessionIdMatch) {
    sessionCookie += `; table_dev_session_user_id=${sessionIdMatch[1]}`;
  }

  // 3. 检查 Provider
  const providerRes = await fetch(`${SERVER_URL}/api/providers/active`, {
    headers: { 'cookie': sessionCookie },
  });
  const providerData = await providerRes.json() as any;
  console.log('Provider:', { name: providerData.name, apiFormat: providerData.apiFormat, baseUrl: providerData.baseUrl, model: providerData.model });

  // 4. 创建 Agent 会话
  const sessionRes = await fetch(`${SERVER_URL}/api/agent/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cookie': sessionCookie,
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ title: 'RAG Test' }),
  });
  const sessionData = await sessionRes.json() as any;
  console.log('会话:', sessionData.id);

  // 5. 发送 Agent 请求
  const agentRes = await fetch(`${SERVER_URL}/api/agent/runs/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cookie': sessionCookie,
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({
      inputText: 'RAG检索知识库，介绍下GPT',
      sessionId: sessionData.id,
      model: 'default',
    }),
  });

  if (!agentRes.ok) {
    console.error('Agent 请求失败:', agentRes.status, await agentRes.text());
    return;
  }

  const reader = agentRes.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tokens = 0;

  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      if (event.includes('event: token')) {
        const dataMatch = event.match(/data: "([^"]+)"/);
        if (dataMatch) { tokens++; process.stdout.write(dataMatch[1]); }
      } else if (event.includes('event:')) {
        const typeMatch = event.match(/event: (\w+)/);
        const dataMatch = event.match(/data: (.+)/);
        if (typeMatch && typeMatch[1] !== 'token' && typeMatch[1] !== 'heartbeat') {
          console.log('\nEvent:', typeMatch[1], dataMatch?.[1]?.slice(0, 100));
        }
      }
    }
  }

  console.log('\nToken 数:', tokens);
}

// 先直接测试 MiniMax API
testMiniMaxDirect().catch(console.error);