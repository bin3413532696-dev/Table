/**
 * Agent RAG 真实请求测试
 */
import 'dotenv/config';

const SERVER_URL = 'http://127.0.0.1:8787';

async function testAgentRAG() {
  console.log('=== Agent RAG 真实请求测试 ===\n');

  // 1. 获取 CSRF Token
  console.log('步骤 1: 获取 CSRF Token...');
  const csrfRes = await fetch(`${SERVER_URL}/api/auth/pin`, {
    method: 'GET',
  });

  if (!csrfRes.ok) {
    console.error('获取 CSRF Token 失败:', csrfRes.status);
    return;
  }

  const csrfPinData = await csrfRes.json();
  const csrfCookie = csrfRes.headers.get('set-cookie');
  let csrfToken = '';

  if (csrfCookie) {
    const match = csrfCookie.match(/table_dev_csrf_token=([^;]+)/);
    if (match) csrfToken = match[1];
  }

  console.log('PIN enabled:', csrfPinData.enabled);
  console.log('CSRF Token:', csrfToken ? '已获取' : '未获取');

  if (!csrfToken) {
    console.error('❌ 无法获取 CSRF Token');
    return;
  }

  // 2. 创建或获取用户
  console.log('\n步骤 2: 获取用户...');
  const usersRes = await fetch(`${SERVER_URL}/api/auth/users`, {
    headers: { 'cookie': `table_dev_csrf_token=${csrfToken}` },
  });

  let userId: string;
  let sessionCookie = `table_dev_csrf_token=${csrfToken}`;

  if (usersRes.ok) {
    const usersData = await usersRes.json();
    console.log('用户数量:', usersData.users?.length ?? 0);

    if (usersData.users && usersData.users.length > 0) {
      userId = usersData.users[0].id;
      console.log('使用现有用户:', userId);
    } else {
      // 创建新用户
      console.log('创建新用户...');
      const createUserRes = await fetch(`${SERVER_URL}/api/auth/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cookie': sessionCookie,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ displayName: 'Test User' }),
      });

      if (!createUserRes.ok) {
        console.error('创建用户失败:', createUserRes.status, await createUserRes.text());
        return;
      }

      const newUser = await createUserRes.json();
      userId = newUser.id;
      console.log('✅ 用户创建成功:', userId);

      // 获取新 session cookie
      const newCookie = createUserRes.headers.get('set-cookie');
      if (newCookie) {
        const sessionMatch = newCookie.match(/table_dev_session_user_id=([^;]+)/);
        if (sessionMatch) {
          sessionCookie += `; table_dev_session_user_id=${sessionMatch[1]}`;
        }
      }
    }
  } else {
    console.error('获取用户失败:', usersRes.status);
    return;
  }

  // 3. 获取 Provider 状态
  console.log('\n步骤 3: 检查 Provider...');
  const providerRes = await fetch(`${SERVER_URL}/api/providers/active`, {
    headers: { 'cookie': sessionCookie },
  });

  if (providerRes.ok) {
    const providerData = await providerRes.json();
    console.log('当前 Provider:', {
      name: providerData.name,
      apiFormat: providerData.apiFormat,
      baseUrl: providerData.baseUrl,
      model: providerData.model,
      hasApiKey: providerData.hasApiKey,
      embeddingModel: providerData.embeddingModel,
      rerankerModel: providerData.rerankerModel,
    });

    // 检查 baseUrl 是否为 localhost（会被安全检查阻止）
    if (providerData.baseUrl?.includes('localhost') || providerData.baseUrl?.includes('127.0.0.1')) {
      console.log('⚠️ Provider baseUrl 使用 localhost，需要确保不是生产环境');
    }
  } else {
    console.log('Provider 状态:', providerRes.status);
  }

  // 4. 检查知识库文档
  console.log('\n步骤 4: 检查知识库...');
  const knowledgeRes = await fetch(`${SERVER_URL}/api/knowledge-rag/documents`, {
    headers: { 'cookie': sessionCookie },
  });

  if (knowledgeRes.ok) {
    const knowledgeData = await knowledgeRes.json();
    console.log('知识库文档数:', knowledgeData.items?.length ?? 0);
  } else {
    console.log('知识库状态:', knowledgeRes.status);
  }

  // 5. 创建 Agent 会话
  console.log('\n步骤 5: 创建 Agent 会话...');
  const sessionRes = await fetch(`${SERVER_URL}/api/agent/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cookie': sessionCookie,
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ title: 'RAG 测试会话' }),
  });

  if (!sessionRes.ok) {
    console.error('创建会话失败:', sessionRes.status, await sessionRes.text());
    return;
  }

  const sessionData = await sessionRes.json();
  const sessionId = sessionData.id;
  console.log('✅ 会话创建成功:', sessionId);

  // 6. 发送 Agent 流式请求
  console.log('\n步骤 6: 发送 Agent RAG 请求...');
  console.log('查询: "RAG检索知识库，介绍下GPT"');

  const agentRes = await fetch(`${SERVER_URL}/api/agent/runs/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cookie': sessionCookie,
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({
      inputText: 'RAG检索知识库，介绍下GPT',
      sessionId,
      model: 'default',
    }),
  });

  if (!agentRes.ok) {
    console.error('Agent 请求失败:', agentRes.status, await agentRes.text());
    return;
  }

  console.log('✅ SSE 连接建立，开始接收事件...\n');

  // 处理 SSE 流
  const reader = agentRes.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tokensReceived = 0;
  let toolCalls = 0;
  let errorReceived = null;
  let finalRun = null;

  if (!reader) {
    console.error('无法获取响应流');
    return;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 解析 SSE 事件
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        const eventType = line.slice(7);
        const nextLine = lines[lines.indexOf(line) + 1];
        if (nextLine?.startsWith('data: ')) {
          const data = JSON.parse(nextLine.slice(6));

          switch (eventType) {
            case 'metadata':
              console.log('📊 Metadata:', data);
              break;
            case 'token':
              tokensReceived++;
              process.stdout.write(data.token);
              break;
            case 'langgraph_chunk':
              if (data.mode === 'tasks') {
                console.log('\n🔧 Task:', data.chunk?.toolName);
              }
              break;
            case 'run_update':
              if (data.run?.executedToolCalls?.length > toolCalls) {
                toolCalls = data.run.executedToolCalls.length;
                console.log('\n🔧 工具调用:', data.run.executedToolCalls.map(tc => tc.name).join(', '));
              }
              break;
            case 'run_completed':
              finalRun = data.run;
              console.log('\n\n✅ 运行完成:', {
                status: data.run?.status,
                finalTextLength: data.run?.finalText?.length ?? 0,
                toolCallsCount: data.run?.executedToolCalls?.length ?? 0,
              });
              break;
            case 'error':
              errorReceived = data.message;
              console.log('\n❌ 错误:', data.message);
              break;
            case 'done':
              console.log('\n📌 流结束');
              break;
          }
        }
      }
    }
  }

  // 输出总结
  console.log('\n=== 测试总结 ===');
  console.log('Token 数量:', tokensReceived);
  console.log('工具调用数:', toolCalls);
  console.log('错误:', errorReceived || '无');

  if (finalRun) {
    console.log('最终状态:', finalRun.status);
    console.log('最终文本长度:', finalRun.finalText?.length ?? 0);

    // 检查问题
    if (tokensReceived === 0) {
      console.log('⚠️ 问题: 未收到任何 token');
    }
    if (finalRun.status === 'failed') {
      console.log('⚠️ 问题: Agent 运行失败');
    }
    if (finalRun.finalText?.length === 0 && tokensReceived > 0) {
      console.log('⚠️ 问题: 有 token 但 finalText 为空（finalText bug）');
    }

    // 检查工具调用
    const ragTools = finalRun.executedToolCalls?.filter(tc =>
      ['semantic_search', 'keyword_search', 'chunk_read', 'cite_sources'].includes(tc.name)
    );
    console.log('RAG 工具调用:', ragTools?.length ?? 0, '次');

    for (const tc of ragTools ?? []) {
      console.log(`  - ${tc.name}:`, tc.success ? '成功' : '失败');
      if (tc.error) {
        console.log(`    错误: ${tc.error}`);
      }
    }
  }
}

testAgentRAG().catch(console.error);