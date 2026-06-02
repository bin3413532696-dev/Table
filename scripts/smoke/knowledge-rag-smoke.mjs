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
    const message =
      payload && typeof payload === 'object' && 'message' in payload
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

function findResultForDocument(results, documentId) {
  return Array.isArray(results) ? results.find((item) => item.documentId === documentId) : undefined;
}

async function main() {
  const suffix = Date.now().toString(36);
  const tagName = `rag-smoke-${suffix}`;
  const title = `RAG Smoke ${suffix}`;
  const query = 'Attention Is All You Need';
  const followupQuery = 'Attention Is All You Need';

  let documentId = null;

  try {
    const baselineStats = await request('/api/knowledge-rag/stats');

    const fileBuffer = await readFile(TEST_FILE_PATH);
    const fileName = path.basename(TEST_FILE_PATH);
    const formData = new FormData();
    formData.append('file', new File([fileBuffer], fileName, { type: 'text/plain' }));
    formData.append('title', title);
    formData.append('tags', JSON.stringify([tagName, 'smoke']));

    const uploadResult = await request('/api/knowledge-rag/documents/upload', {
      method: 'POST',
      body: formData,
    });

    const document = uploadResult?.document;
    const uploadJob = uploadResult?.job;
    documentId = document?.id || null;

    assert(documentId, '上传成功但未返回 document.id。');
    assert(document.title === title, '上传后的文档标题不正确。');
    assert(document.status === 'indexed', `上传后文档状态异常: ${document.status}`);
    assert(uploadJob?.status === 'completed', `上传索引任务未完成: ${uploadJob?.status}`);
    assert(uploadJob?.error == null, `上传索引任务存在异常: ${JSON.stringify(uploadJob?.error)}`);

    const statsAfterUpload = await request('/api/knowledge-rag/stats');
    assert(
      Number(statsAfterUpload.documentCount) >= Number(baselineStats.documentCount) + 1,
      '上传后文档总数未增加。'
    );
    assert(
      Number(statsAfterUpload.indexedDocumentCount) >= Number(baselineStats.indexedDocumentCount) + 1,
      '上传后已索引文档数未增加。'
    );

    const listedDocuments = await request(`/api/knowledge-rag/documents?tags=${encodeURIComponent(tagName)}&limit=10`);
    const listedDocument = Array.isArray(listedDocuments?.items)
      ? listedDocuments.items.find((item) => item.id === documentId)
      : null;
    assert(listedDocument, '文档列表未返回刚上传的文档。');

    const documentDetail = await request(`/api/knowledge-rag/documents/${documentId}`);
    assert(documentDetail.status === 'indexed', `文档详情状态异常: ${documentDetail.status}`);
    assert(String(documentDetail.content || '').includes('Transformer'), '文档详情未包含预期正文内容。');

    const chunks = await request(`/api/knowledge-rag/chunks?documentId=${documentId}&limit=10`);
    assert(Number(chunks?.total) > 0, '未生成任何分块。');
    assert(Array.isArray(chunks?.items) && chunks.items.length > 0, '分块列表为空。');
    assert(Number(chunks?.total) > 1, '长文本未被拆分成多个 chunk。');

    const jobs = await request(`/api/knowledge-rag/jobs?documentId=${documentId}&limit=10`);
    assert(Array.isArray(jobs?.items) && jobs.items.some((item) => item.id === uploadJob.id), '任务列表未返回上传索引任务。');

    const alreadyIndexed = await request(`/api/knowledge-rag/documents/${documentId}/index`, {
      method: 'POST',
      body: JSON.stringify({ force: false }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    assert(
      typeof alreadyIndexed?.message === 'string' && alreadyIndexed.message.includes('already indexed'),
      '重复索引提示不符合预期。'
    );

    const reindexResult = await request(`/api/knowledge-rag/documents/${documentId}/index`, {
      method: 'POST',
      body: JSON.stringify({ force: true }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    assert(reindexResult?.job?.status === 'completed', `强制重建索引未完成: ${reindexResult?.job?.status}`);

    const hybridSearch = await request('/api/knowledge-rag/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        tags: [tagName],
        mode: 'hybrid',
        limit: 5,
        threshold: 0.05,
        enableRerank: true,
        rerankerThreshold: 0,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    assert(Number(hybridSearch?.semanticCount) > 0, 'Hybrid 检索未产生语义召回结果。');
    assert(typeof hybridSearch?.rerankTimeMs === 'number', 'Hybrid 检索未执行 rerank。');
    const hybridHit = findResultForDocument(hybridSearch?.results, documentId);
    assert(hybridHit, 'Hybrid 检索未命中目标文档。');
    assert(
      String(hybridHit.content || '').includes('Attention Is All You Need') ||
        String(hybridHit.content || '').includes('Transformer'),
      'Hybrid 检索命中内容不符合预期。'
    );

    const keywordSearch = await request('/api/knowledge-rag/search', {
      method: 'POST',
      body: JSON.stringify({
        query: followupQuery,
        tags: [tagName],
        mode: 'keyword',
        limit: 5,
        threshold: 0.05,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const keywordHit = findResultForDocument(keywordSearch?.results, documentId);
    assert(keywordHit, 'Keyword 检索未命中目标文档。');

    const contextSearch = await request('/api/knowledge-rag/search/context', {
      method: 'POST',
      body: JSON.stringify({
        query,
        tags: [tagName],
        mode: 'hybrid',
        limit: 3,
        threshold: 0.05,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    assert(
      typeof contextSearch?.context === 'string' &&
        contextSearch.context.includes(`[${title}]`) &&
        contextSearch.context.includes('Transformer'),
      '上下文拼装结果异常。'
    );

    await request(`/api/knowledge-rag/documents/${documentId}`, {
      method: 'DELETE',
    });
    documentId = null;

    const statsAfterDelete = await request('/api/knowledge-rag/stats');
    assert(
      Number(statsAfterDelete.documentCount) <= Number(statsAfterUpload.documentCount) - 1,
      '删除后文档总数未回落。'
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          file: TEST_FILE_PATH,
          title,
          tagName,
          documentId: document.id,
          uploadJobId: uploadJob.id,
          reindexJobId: reindexResult.job.id,
          chunkCount: chunks.total,
          hybridResultCount: hybridSearch.results.length,
          keywordResultCount: keywordSearch.results.length,
          stats: {
            before: baselineStats,
            afterUpload: statsAfterUpload,
            afterDelete: statsAfterDelete,
          },
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
