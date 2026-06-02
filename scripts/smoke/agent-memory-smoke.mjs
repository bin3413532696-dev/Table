const SERVER_ORIGIN = process.env.KNOWLEDGE_API_ORIGIN || 'http://127.0.0.1:8787';
const DEFAULT_USER_ID = process.env.KNOWLEDGE_USER_ID || '00000000-0000-0000-0000-000000000001';
const CSRF_COOKIE_NAME = 'table_dev_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

const cookieJar = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storeCookies(response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const cookieHeaders = getSetCookie ? getSetCookie() : [];

  for (const header of cookieHeaders) {
    const [cookiePart] = String(header).split(';');
    const separatorIndex = cookiePart.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }

    cookieJar.set(name, value);
  }
}

function buildCookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function ensureCsrfCookie() {
  if (cookieJar.has(CSRF_COOKIE_NAME)) {
    return;
  }

  const response = await fetch(`${SERVER_ORIGIN}/api/agent/health`, {
    headers: {
      'x-user-id': DEFAULT_USER_ID,
    },
  });

  if (!response.ok) {
    throw new Error(`GET /api/agent/health failed: HTTP ${response.status}`);
  }

  storeCookies(response);
}

async function request(pathname, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    await ensureCsrfCookie();
  }

  const headers = {
    'x-user-id': DEFAULT_USER_ID,
    ...(init.headers || {}),
  };

  const cookieHeader = buildCookieHeader();
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const csrfToken = cookieJar.get(CSRF_COOKIE_NAME);
  if (csrfToken && !headers[CSRF_HEADER_NAME] && method !== 'GET') {
    headers[CSRF_HEADER_NAME] = csrfToken;
  }

  const response = await fetch(`${SERVER_ORIGIN}${pathname}`, {
    ...init,
    method,
    headers,
  });

  storeCookies(response);

  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const detail = payload?.detail;
    const message =
      detail && typeof detail === 'object' && 'message' in detail
        ? detail.message
        : payload && typeof payload === 'object' && 'message' in payload
          ? payload.message
          : `HTTP ${response.status}`;
    throw new Error(`${method} ${pathname} failed: ${message}`);
  }

  return payload;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runAgentTurn(sessionId, inputText) {
  const run = await request('/api/agent/runs', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      inputText,
      model: 'default',
      ragEnabled: false,
      initialMessages: [],
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  });

  assert(run?.status === 'completed', `Agent run 未完成: ${run?.status}`);
  return run;
}

function hasMemoryContent(memory) {
  return Boolean(
    memory?.summary ||
    memory?.preferences?.length ||
    memory?.facts?.length ||
    memory?.goals?.length ||
    memory?.todos?.length ||
    memory?.rules?.length
  );
}

async function waitForMemoryReady(sessionId, timeoutMs = 90000) {
  const startedAt = Date.now();
  const snapshots = [];

  while (Date.now() - startedAt < timeoutMs) {
    const memory = await request(`/api/agent/sessions/${sessionId}/memory`);
    snapshots.push({
      status: memory?.status,
      disabled: memory?.disabled,
      runCount: memory?.runCount,
      updatedAt: memory?.updatedAt ?? null,
    });

    if (memory?.status === 'ready' && hasMemoryContent(memory) && Number(memory.runCount) >= 3) {
      return { memory, snapshots };
    }

    if (memory?.status === 'failed') {
      throw new Error('会话记忆生成失败。');
    }

    await sleep(2000);
  }

  throw new Error(`等待会话记忆 ready 超时。状态轨迹: ${JSON.stringify(snapshots)}`);
}

async function main() {
  const suffix = Date.now().toString(36);
  const title = `Memory Smoke ${suffix}`;
  let sessionId = null;

  try {
    const createdSession = await request('/api/agent/sessions', {
      method: 'POST',
      body: JSON.stringify({ title }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    sessionId = createdSession?.id || null;
    assert(sessionId, '创建会话成功但未返回 sessionId。');

    const initialMemory = await request(`/api/agent/sessions/${sessionId}/memory`);
    assert(initialMemory?.status === 'idle', `初始记忆状态异常: ${initialMemory?.status}`);
    assert(initialMemory?.disabled === false, '初始记忆不应默认关闭。');
    assert(Number(initialMemory?.runCount) === 0, '初始记忆 runCount 应为 0。');

    const turns = [
      '后续回答请尽量简洁，优先用要点列表。请只回复“收到”。',
      '我现在正在做会话记忆 smoke，请记住当前任务与会话记忆验证有关。请只回复“收到”。',
      '接下来我还会检查记忆关闭和删除流程。请只回复“收到”。',
    ];

    for (const inputText of turns) {
      await runAgentTurn(sessionId, inputText);
    }

    const { memory: readyMemory, snapshots } = await waitForMemoryReady(sessionId);
    assert(readyMemory.status === 'ready', `记忆未进入 ready: ${readyMemory.status}`);
    assert(readyMemory.disabled === false, 'ready 状态下记忆不应被关闭。');
    assert(Number(readyMemory.runCount) >= 3, `记忆 runCount 异常: ${readyMemory.runCount}`);
    assert(hasMemoryContent(readyMemory), '记忆 ready 但没有任何内容。');

    const disabledMemory = await request(`/api/agent/sessions/${sessionId}/memory/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled: true }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    assert(disabledMemory?.disabled === true, '关闭记忆失败。');

    const disabledRunCount = Number(disabledMemory.runCount);
    const disabledUpdatedAt = disabledMemory.updatedAt ?? null;

    await runAgentTurn(sessionId, '这是关闭记忆后的额外一轮对话。请只回复“收到”。');
    await runAgentTurn(sessionId, '这是关闭记忆后的第二轮对话。请只回复“收到”。');
    await sleep(4000);

    const memoryAfterDisabledRuns = await request(`/api/agent/sessions/${sessionId}/memory`);
    assert(memoryAfterDisabledRuns?.disabled === true, '关闭记忆后 disabled 状态丢失。');
    assert(
      Number(memoryAfterDisabledRuns?.runCount) === disabledRunCount,
      `关闭记忆后 runCount 不应推进: ${memoryAfterDisabledRuns?.runCount} !== ${disabledRunCount}`
    );
    assert(
      (memoryAfterDisabledRuns?.updatedAt ?? null) === disabledUpdatedAt,
      '关闭记忆后 updatedAt 不应变化。'
    );
    assert(
      !['pending', 'processing'].includes(String(memoryAfterDisabledRuns?.status)),
      `关闭记忆后不应进入待更新状态: ${memoryAfterDisabledRuns?.status}`
    );

    const deletedMemory = await request(`/api/agent/sessions/${sessionId}/memory`, {
      method: 'DELETE',
    });
    assert(deletedMemory?.status === 'idle', `删除后记忆状态异常: ${deletedMemory?.status}`);
    assert(deletedMemory?.disabled === true, '删除记忆后 disabled 应保持当前会话设置。');
    assert(Number(deletedMemory?.runCount) === 0, '删除记忆后 runCount 应清零。');
    assert(!hasMemoryContent(deletedMemory), '删除记忆后内容未清空。');

    await request(`/api/agent/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    sessionId = null;

    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId: createdSession.id,
          title,
          readyMemory: {
            status: readyMemory.status,
            runCount: readyMemory.runCount,
            updatedAt: readyMemory.updatedAt ?? null,
            summary: readyMemory.summary,
            preferences: readyMemory.preferences,
            facts: readyMemory.facts,
            goals: readyMemory.goals,
            todos: readyMemory.todos,
            rules: readyMemory.rules,
          },
          readySnapshots: snapshots,
          disabledMemory: {
            status: memoryAfterDisabledRuns.status,
            disabled: memoryAfterDisabledRuns.disabled,
            runCount: memoryAfterDisabledRuns.runCount,
            updatedAt: memoryAfterDisabledRuns.updatedAt ?? null,
          },
          deletedMemory: {
            status: deletedMemory.status,
            disabled: deletedMemory.disabled,
            runCount: deletedMemory.runCount,
          },
        },
        null,
        2
      )
    );
  } finally {
    if (sessionId) {
      await request(`/api/agent/sessions/${sessionId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
