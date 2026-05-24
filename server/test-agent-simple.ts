/**
 * 简化的 Agent RAG 测试
 */
import 'dotenv/config';

const SERVER_URL = 'http://127.0.0.1:8787';

async function testAgentRAG() {
  console.log('=== Agent RAG 简化测试 ===\n');

  // 1. GET /api/auth/pin 获取 CSRF Cookie
  console.log('步骤 1: 获取 CSRF Cookie...');
  const csrfRes = await fetch(`${SERVER_URL}/api/auth/pin`, {
    method: 'GET',
  });

  const csrfCookie = csrfRes.headers.get('set-cookie');
  if (csrfCookie) {
    console.log('✅ CSRF Cookie:', csrfCookie.split(';')[0]);
  } else {
    // 尝试其他端点
    const meRes = await fetch(`${SERVER_URL}/api/auth/me`, { method: 'GET' });
    const meCookie = meRes.headers.get('set-cookie');
    console.log('尝试 /api/auth/me Cookie:', meCookie?.split(';')[0] || '未获取');
  }

  // 2. 检查 Provider
  console.log('\n步骤 2: 检查 Provider...');
  const providerRes = await fetch(`${SERVER_URL}/api/providers/active`, { method: 'GET' });

  if (providerRes.ok) {
    const provider = await providerRes.json();
    console.log('Provider:', {
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat,
      model: provider.model,
      hasApiKey: provider.hasApiKey,
    });
  } else {
    console.log('Provider 检查失败:', providerRes.status);
    const providerText = await providerRes.text();
    console.log('响应:', providerText.slice(0, 200));
    return;
  }

  // 3. 从 Cookie 提取 CSRF Token
  const allCookies = [csrfCookie];
  let csrfToken = '';
  let allCookieStr = '';

  for (const c of allCookies) {
    if (c) {
      allCookieStr += c.split(';')[0] + '; ';
      if (c.includes('table_dev_csrf_token=')) {
        const match = c.match(/table_dev_csrf_token=([^;]+)/);
        if (match) csrfToken = match[1];
      }
    }
  }

  console.log('CSRF Token:', csrfToken || '未找到');

  if (!csrfToken) {
    console.log('⚠️ 无法获取 CSRF Token，可能需要通过浏览器访问');
    return;
  }

  // 4. 发送 Agent 流式请求
  console.log('\n步骤 3: 发送 Agent RAG 请求...');
  console.log('查询: "RAG检索知识库，介绍下GPT"');

  const agentRes = await fetch(`${SERVER_URL}/api/agent/runs/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cookie': allCookieStr.trim(),
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({
      inputText: 'RAG检索知识库，介绍下GPT',
      model: 'default',
    }),
  });

  if (!agentRes.ok) {
    console.error('Agent 请求失败:', agentRes.status);
    const errorText = await agentRes.text();
    console.error('错误:', errorText);
    return;
  }

  console.log('✅ SSE 连接建立');

  // 处理 SSE
  const reader = agentRes.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  if (!reader) {
    console.error('无法读取响应流');
    return;
  }

  let tokensReceived = 0;
  let lastEvent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log('\n📌 流结束');
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    // 解析 SSE
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      if (event.includes('event: token')) {
        const dataMatch = event.match(/data: "([^"]+)"/);
        if (dataMatch) {
          tokensReceived++;
          process.stdout.write(dataMatch[1]);
        }
      } else if (event.includes('event:')) {
        const typeMatch = event.match(/event: (\w+)/);
        if (typeMatch) {
          lastEvent = typeMatch[1];
          if (typeMatch[1] !== 'token' && typeMatch[1] !== 'heartbeat') {
            const dataMatch = event.match(/data: (.+)/);
            if (dataMatch) {
              console.log('\n📋 Event:', typeMatch[1], dataMatch[1].slice(0, 100));
            }
          }
        }
      }
    }
  }

  console.log('\n=== 测试总结 ===');
  console.log('Token 数量:', tokensReceived);
  console.log('最后事件:', lastEvent);
}

testAgentRAG().catch(console.error);