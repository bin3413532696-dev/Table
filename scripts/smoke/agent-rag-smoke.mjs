import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SERVER_ORIGIN = process.env.KNOWLEDGE_API_ORIGIN || 'http://127.0.0.1:8787';
const DEFAULT_USER_ID = process.env.KNOWLEDGE_USER_ID || '00000000-0000-0000-0000-000000000001';
const CSRF_COOKIE_NAME = 'table_dev_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const TEST_FILE_PATH = process.env.RAG_SMOKE_FILE || path.resolve(process.cwd(), '大模型发展历程.txt');

const cookieJar = new Map();

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

  const response = await fetch(`${SERVER_ORIGIN}/api/knowledge-rag/stats`, {
    headers: {
      'x-user-id': DEFAULT_USER_ID,
    },
  });

  if (!response.ok) {
    throw new Error(`GET /api/knowledge-rag/stats failed: HTTP ${response.status}`);
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

async function main() {
  const suffix = Date.now().toString(36);
  const tagName = `agent-rag-smoke-${suffix}`;
  const title = `Agent RAG Smoke ${suffix}`;
  const question = '请根据知识库回答：文中提到的 Transformer 标志性论文英文名是什么？请只回答论文名并补一句简短说明。';

  let documentId = null;

  try {
    const fileBuffer = await readFile(TEST_FILE_PATH);
    const fileName = path.basename(TEST_FILE_PATH);
    const formData = new FormData();
    formData.append('file', new File([fileBuffer], fileName, { type: 'text/plain' }));
    formData.append('title', title);
    formData.append('tags', JSON.stringify([tagName, 'agent-rag-smoke']));

    const uploadResult = await request('/api/knowledge-rag/documents/upload', {
      method: 'POST',
      body: formData,
    });

    const document = uploadResult?.document;
    documentId = document?.id || null;
    assert(documentId, '上传成功但未返回 document.id。');
    assert(document?.status === 'indexed', `上传后文档状态异常: ${document?.status}`);

    const agentHealth = await request('/api/agent/health');
    assert(agentHealth?.ok === true, 'Agent 运行时未连接。');

    const run = await request('/api/agent/runs', {
      method: 'POST',
      body: JSON.stringify({
        inputText: question,
        model: 'default',
        ragEnabled: true,
        initialMessages: [],
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const executedToolCalls = Array.isArray(run?.executedToolCalls) ? run.executedToolCalls : [];
    const ragToolNames = new Set(['rag_answer', 'search_knowledge_rag', 'semantic_search', 'keyword_search', 'chunk_read']);

    assert(run?.status === 'completed', `Agent run 状态异常: ${run?.status}`);
    assert(
      executedToolCalls.some((tool) => ragToolNames.has(tool.toolName)),
      'Agent 未执行任何 RAG 检索工具。'
    );
    assert(
      executedToolCalls.some((tool) => tool.toolName === 'rag_answer'),
      'Agent 未执行强制预检索工具 rag_answer。'
    );
    assert(typeof run?.finalText === 'string' && run.finalText.trim().length > 0, 'Agent 最终回答为空。');
    assert(!run.finalText.includes('tool_call'), 'Agent 最终回答包含未清理的工具标记。');
    assert(
      /知识库|检索|来源/.test(run.finalText),
      'Agent 最终回答未体现知识库检索结果。'
    );

    await request(`/api/knowledge-rag/documents/${documentId}`, {
      method: 'DELETE',
    });
    documentId = null;

    console.log(
      JSON.stringify(
        {
          ok: true,
          file: TEST_FILE_PATH,
          title,
          tagName,
          documentId: document.id,
          agentRunId: run.id,
          finalText: run.finalText,
          executedToolCalls: executedToolCalls.map((tool) => tool.toolName),
        },
        null,
        2
      )
    );
  } finally {
    if (documentId) {
      await request(`/api/knowledge-rag/documents/${documentId}`, {
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
        file: TEST_FILE_PATH,
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
