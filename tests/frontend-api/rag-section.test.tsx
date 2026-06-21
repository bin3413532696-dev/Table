import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import type { RenderResult } from '@testing-library/react';

import { RagSection } from '../../src/features/knowledge/components/RagSection';
import type {
  IndexJob,
  KnowledgeChunk,
  KnowledgeCorpus,
  KnowledgeDocument,
  RagStats,
  SearchResult,
  UploadResult,
} from '../../src/features/knowledge/types';
import { renderWithDom, testingLibrary } from './dom-test-helpers';

function makeDocument(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: 'doc-1',
    userId: 'user-1',
    corpusIds: [],
    title: 'sample.pdf',
    summary: '',
    content: '',
    source: 'sample.pdf',
    fileType: 'pdf',
    fileSize: 2048,
    status: 'pending',
    tags: [],
    contentHash: null,
    version: 1,
    publishDate: null,
    sourceDept: null,
    securityLevel: null,
    businessCategory: null,
    docLanguage: null,
    parseQuality: null,
    hasOcr: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeStats(overrides: Partial<RagStats> = {}): RagStats {
  return {
    documentCount: 0,
    indexedDocumentCount: 0,
    chunkCount: 0,
    chunkWithEmbeddingCount: 0,
    cacheCount: 0,
    ...overrides,
  };
}

function makeJob(overrides: Partial<IndexJob> = {}): IndexJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    documentId: 'doc-1',
    jobType: 'index',
    status: 'pending',
    progress: 0,
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: 1,
    ...overrides,
  };
}

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'result-1',
    documentId: 'doc-1',
    documentTitle: 'indexed.pdf',
    content: '这是命中的知识片段内容',
    chunkIndex: 0,
    score: 0.91,
    source: 'semantic',
    sourceInfo: null,
    publishDate: null,
    sourceDept: null,
    securityLevel: null,
    businessCategory: null,
    ...overrides,
  };
}

function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: 'chunk-1',
    documentId: 'doc-1',
    userId: 'user-1',
    content: '这是分块详情内容',
    contentHash: 'hash-1',
    chunkIndex: 0,
    startPos: 0,
    endPos: 24,
    hasEmbedding: true,
    embeddingModel: 'text-embedding-3-large',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test('RagSection refreshes documents and stats after upload success', { concurrency: false }, async () => {
  const ragModule = require('../../src/features/knowledge/api/rag') as typeof import('../../src/features/knowledge/api/rag');
  const originalGetStats = ragModule.getStats;
  const originalGetCorpora = ragModule.getCorpora;
  const originalGetDocuments = ragModule.getDocuments;
  const originalGetJobs = ragModule.getJobs;
  const originalUploadDocument = ragModule.uploadDocument;

  const feedbacks: Array<{ type: 'success' | 'error'; message: string }> = [];
  const uploadedFiles: string[] = [];
  const statsCalls: number[] = [];
  const documentCalls: number[] = [];
  const uploadedDocument = makeDocument();
  let view: RenderResult | undefined;

  ragModule.getStats = async () => {
    statsCalls.push(statsCalls.length + 1);
    return uploadedFiles.length === 0
      ? makeStats()
      : makeStats({ documentCount: 1, indexedDocumentCount: 0 });
  };
  ragModule.getCorpora = async () => ({ items: [], total: 0 });
  ragModule.getDocuments = async () => {
    documentCalls.push(documentCalls.length + 1);
    return {
      items: uploadedFiles.length === 0 ? [] : [uploadedDocument],
      total: uploadedFiles.length,
    };
  };
  ragModule.getJobs = async () => ({ items: [], total: 0 });
  ragModule.uploadDocument = async (file: File): Promise<UploadResult> => {
    uploadedFiles.push(file.name);
    return {
      document: uploadedDocument,
      job: makeJob(),
    };
  };

  try {
    const { fireEvent, waitFor } = testingLibrary();
    view = renderWithDom(React.createElement(RagSection, {
      onFeedback: (type, message) => feedbacks.push({ type, message }),
    }));
    const renderedView = view;

    await waitFor(() => {
      assert.equal(renderedView.getByText('暂无文档，上传文件开始使用').textContent, '暂无文档，上传文件开始使用');
    });

    const input = renderedView.container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['pdf'], 'sample.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      assert.deepEqual(uploadedFiles, ['sample.pdf']);
      assert.equal(renderedView.getByText('sample.pdf').textContent, 'sample.pdf');
      assert.equal(renderedView.getByText('待处理').textContent, '待处理');
      assert.ok(feedbacks.some((item) => item.type === 'success' && item.message === '文档上传成功，正在索引'));
      assert.ok(statsCalls.length >= 2);
      assert.ok(documentCalls.length >= 2);
    });
  } finally {
    view?.unmount();
    ragModule.getStats = originalGetStats;
    ragModule.getCorpora = originalGetCorpora;
    ragModule.getDocuments = originalGetDocuments;
    ragModule.getJobs = originalGetJobs;
    ragModule.uploadDocument = originalUploadDocument;
  }
});

test('RagSection creates a corpus and selects it after refresh', { concurrency: false }, async () => {
  const ragModule = require('../../src/features/knowledge/api/rag') as typeof import('../../src/features/knowledge/api/rag');
  const originalGetStats = ragModule.getStats;
  const originalGetCorpora = ragModule.getCorpora;
  const originalGetDocuments = ragModule.getDocuments;
  const originalCreateCorpus = ragModule.createCorpus;

  const feedbacks: Array<{ type: 'success' | 'error'; message: string }> = [];
  const createdNames: string[] = [];
  let corpora: KnowledgeCorpus[] = [];
  let view: RenderResult | undefined;

  ragModule.getStats = async () => makeStats();
  ragModule.getDocuments = async () => ({ items: [], total: 0 });
  ragModule.getCorpora = async () => ({ items: corpora, total: corpora.length });
  ragModule.createCorpus = async ({ name }) => {
    createdNames.push(name);
    const created: KnowledgeCorpus = {
      id: 'corpus-1',
      userId: 'user-1',
      name,
      description: '',
      defaultTags: [],
      documentIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
    corpora = [created];
    return created;
  };

  try {
    const { fireEvent, waitFor } = testingLibrary();
    view = renderWithDom(React.createElement(RagSection, {
      onFeedback: (type, message) => feedbacks.push({ type, message }),
    }));
    const renderedView = view;

    await waitFor(() => {
      const select = renderedView.container.querySelector('select') as HTMLSelectElement;
      assert.equal(select.value, '');
    });

    const input = renderedView.getByPlaceholderText('新资料集名称') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '热力学教材' } });
    await waitFor(() => {
      const createButton = renderedView.getByText('新建') as HTMLButtonElement;
      assert.equal(createButton.disabled, false);
    });
    fireEvent.click(renderedView.getByText('新建'));

    await waitFor(() => {
      const select = renderedView.container.querySelector('select') as HTMLSelectElement;
      assert.deepEqual(createdNames, ['热力学教材']);
      assert.equal(select.value, 'corpus-1');
      assert.ok(renderedView.getByText('热力学教材 (0)'));
      assert.ok(feedbacks.some((item) => item.type === 'success' && item.message === '资料集已创建'));
    });
  } finally {
    view?.unmount();
    ragModule.getStats = originalGetStats;
    ragModule.getCorpora = originalGetCorpora;
    ragModule.getDocuments = originalGetDocuments;
    ragModule.createCorpus = originalCreateCorpus;
  }
});

test('RagSection searches documents and opens detail from results', { concurrency: false }, async () => {
  const ragModule = require('../../src/features/knowledge/api/rag') as typeof import('../../src/features/knowledge/api/rag');
  const originalGetStats = ragModule.getStats;
  const originalGetCorpora = ragModule.getCorpora;
  const originalGetDocuments = ragModule.getDocuments;
  const originalSearch = ragModule.search;
  const originalGetChunks = ragModule.getChunks;

  const indexedDocument = makeDocument({
    title: 'indexed.pdf',
    source: 'indexed.pdf',
    status: 'indexed',
    summary: '已索引文档摘要',
  });
  const searchCalls: Array<{ query?: string; mode?: string }> = [];
  let view: RenderResult | undefined;

  ragModule.getStats = async () => makeStats({ documentCount: 1, indexedDocumentCount: 1, chunkWithEmbeddingCount: 1 });
  ragModule.getCorpora = async () => ({ items: [], total: 0 });
  ragModule.getDocuments = async () => ({ items: [indexedDocument], total: 1 });
  ragModule.search = async (input) => {
    searchCalls.push({ query: input.query, mode: input.mode });
    return {
      results: [makeSearchResult({ documentId: indexedDocument.id, documentTitle: indexedDocument.title })],
      semanticCount: 1,
      keywordCount: 0,
      queryEmbeddingTimeMs: 3,
      searchTimeMs: 12,
    };
  };
  ragModule.getChunks = async () => ({
    items: [
      makeChunk({
        id: 'child-1',
        documentId: indexedDocument.id,
        chunkIndex: 0,
        chunkType: 'small',
        parentId: 'parent-1',
      }),
      makeChunk({
        id: 'child-2',
        documentId: indexedDocument.id,
        chunkIndex: 1,
        chunkType: 'small',
        parentId: 'parent-1',
      }),
      makeChunk({
        id: 'parent-1',
        documentId: indexedDocument.id,
        chunkIndex: 2,
        chunkType: 'parent',
        parentId: null,
        hasEmbedding: false,
        embeddingModel: null,
        content: '父块汇总内容',
      }),
    ],
    total: 3,
  });

  try {
    const { fireEvent, waitFor } = testingLibrary();
    view = renderWithDom(React.createElement(RagSection));
    const renderedView = view;

    await waitFor(() => {
      assert.equal(renderedView.getByText('indexed.pdf').textContent, 'indexed.pdf');
    });

    fireEvent.click(renderedView.getByText('检索测试'));

    const searchInput = renderedView.getByPlaceholderText('搜索知识库...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: '向量检索' } });
    fireEvent.click(renderedView.getByText('语义'));
    fireEvent.click(renderedView.getByText('搜索'));

    await waitFor(() => {
      assert.deepEqual(searchCalls, [{ query: '向量检索', mode: 'semantic' }]);
      assert.equal(renderedView.getByText('找到 1 条结果，耗时 12ms').textContent, '找到 1 条结果，耗时 12ms');
      assert.equal(renderedView.getByText('这是命中的知识片段内容').textContent, '这是命中的知识片段内容');
    });

    const openButton = renderedView.container.querySelector('button[title="查看文档"]') as HTMLButtonElement;
    fireEvent.click(openButton);

    await waitFor(() => {
      assert.equal(renderedView.getAllByText('indexed.pdf')[0]?.textContent, 'indexed.pdf');
      assert.equal(renderedView.getByText('分块列表 (3 个)').textContent, '分块列表 (3 个)');
      assert.equal(renderedView.getByText('已索引文档摘要').textContent, '已索引文档摘要');
      assert.equal(renderedView.getByText('子块 2').textContent, '子块 2');
      assert.equal(renderedView.getByText('父块 1').textContent, '父块 1');
      assert.ok(renderedView.getByText('父块 #2'));
      assert.ok(renderedView.getByText('子块 #0'));
    });
  } finally {
    view?.unmount();
    ragModule.getStats = originalGetStats;
    ragModule.getCorpora = originalGetCorpora;
    ragModule.getDocuments = originalGetDocuments;
    ragModule.search = originalSearch;
    ragModule.getChunks = originalGetChunks;
  }
});

test('RagSection detail reindex action triggers refresh and success feedback', { concurrency: false }, async () => {
  const ragModule = require('../../src/features/knowledge/api/rag') as typeof import('../../src/features/knowledge/api/rag');
  const originalGetStats = ragModule.getStats;
  const originalGetCorpora = ragModule.getCorpora;
  const originalGetDocuments = ragModule.getDocuments;
  const originalGetChunks = ragModule.getChunks;
  const originalGetJobs = ragModule.getJobs;
  const originalTriggerIndex = ragModule.triggerIndex;

  const feedbacks: Array<{ type: 'success' | 'error'; message: string }> = [];
  const triggerCalls: Array<{ id: string; force: boolean | undefined }> = [];
  const documentsByCall = [
    [makeDocument({ id: 'doc-1', title: 'indexed.pdf', source: 'indexed.pdf', status: 'indexed', summary: '索引完成' })],
    [makeDocument({ id: 'doc-1', title: 'indexed.pdf', source: 'indexed.pdf', status: 'pending', summary: '重新索引中' })],
  ];
  let getDocumentsCallCount = 0;
  let view: RenderResult | undefined;

  ragModule.getStats = async () => makeStats({ documentCount: 1, indexedDocumentCount: 1, chunkWithEmbeddingCount: 1 });
  ragModule.getCorpora = async () => ({ items: [], total: 0 });
  ragModule.getDocuments = async () => {
    const items = documentsByCall[Math.min(getDocumentsCallCount, documentsByCall.length - 1)] || [];
    getDocumentsCallCount += 1;
    return { items, total: items.length };
  };
  ragModule.getChunks = async () => ({
    items: [makeChunk()],
    total: 1,
  });
  ragModule.getJobs = async () => ({
    items: [makeJob({ documentId: 'doc-1', status: 'pending' })],
    total: 1,
  });
  ragModule.triggerIndex = async (id: string, force?: boolean) => {
    triggerCalls.push({ id, force });
    return { job: makeJob({ documentId: id, status: 'pending' }) };
  };

  try {
    const { fireEvent, waitFor } = testingLibrary();
    view = renderWithDom(React.createElement(RagSection, {
      onFeedback: (type, message) => feedbacks.push({ type, message }),
    }));
    const renderedView = view;

    await waitFor(() => {
      assert.equal(renderedView.getByText('indexed.pdf').textContent, 'indexed.pdf');
      assert.ok(renderedView.getAllByText('已索引').length >= 1);
    });

    fireEvent.click(renderedView.getByText('indexed.pdf'));

    await waitFor(() => {
      assert.equal(renderedView.getByText('分块列表 (1 个)').textContent, '分块列表 (1 个)');
      assert.equal(renderedView.getByText('重新索引').textContent, '重新索引');
    });

    fireEvent.click(renderedView.getByText('重新索引'));

    await waitFor(() => {
      assert.deepEqual(triggerCalls, [{ id: 'doc-1', force: true }]);
      assert.ok(feedbacks.some((item) => item.type === 'success' && item.message === '已发起重新索引'));
      assert.ok(renderedView.getAllByText('待处理').length >= 1);
      assert.ok(getDocumentsCallCount >= 2);
    });
  } finally {
    view?.unmount();
    ragModule.getStats = originalGetStats;
    ragModule.getCorpora = originalGetCorpora;
    ragModule.getDocuments = originalGetDocuments;
    ragModule.getChunks = originalGetChunks;
    ragModule.getJobs = originalGetJobs;
    ragModule.triggerIndex = originalTriggerIndex;
  }
});

test('RagSection detail add-to-corpus action updates corpus membership', { concurrency: false }, async () => {
  const ragModule = require('../../src/features/knowledge/api/rag') as typeof import('../../src/features/knowledge/api/rag');
  const originalGetStats = ragModule.getStats;
  const originalGetCorpora = ragModule.getCorpora;
  const originalGetDocuments = ragModule.getDocuments;
  const originalGetDocument = ragModule.getDocument;
  const originalGetChunks = ragModule.getChunks;
  const originalUpdateCorpus = ragModule.updateCorpus;

  const feedbacks: Array<{ type: 'success' | 'error'; message: string }> = [];
  const updateCalls: Array<{ id: string; documentIds?: string[] }> = [];
  let corpora: KnowledgeCorpus[] = [
    {
      id: 'corpus-1',
      userId: 'user-1',
      name: '热力学教材',
      description: '',
      defaultTags: [],
      documentIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  let documentInCorpus = false;
  let view: RenderResult | undefined;

  ragModule.getStats = async () => makeStats({ documentCount: 1, indexedDocumentCount: 1, chunkWithEmbeddingCount: 1 });
  ragModule.getCorpora = async () => ({ items: corpora, total: corpora.length });
  ragModule.getDocuments = async () => {
    const document = makeDocument({
      id: 'doc-1',
      title: 'indexed.pdf',
      source: 'indexed.pdf',
      status: 'indexed',
      summary: '可加入资料集',
      corpusIds: documentInCorpus ? ['corpus-1'] : [],
    });
    return { items: [document], total: 1 };
  };
  ragModule.getDocument = async () => makeDocument({
    id: 'doc-1',
    title: 'indexed.pdf',
    source: 'indexed.pdf',
    status: 'indexed',
    summary: '可加入资料集',
    corpusIds: documentInCorpus ? ['corpus-1'] : [],
  });
  ragModule.getChunks = async () => ({
    items: [makeChunk()],
    total: 1,
  });
  ragModule.updateCorpus = async (id: string, data: { documentIds?: string[] }) => {
    updateCalls.push({ id, documentIds: data.documentIds });
    corpora = [
      {
        ...corpora[0]!,
        documentIds: data.documentIds || [],
      },
    ];
    documentInCorpus = Boolean(data.documentIds && data.documentIds.length > 0);
    return corpora[0]!;
  };

  try {
    const { fireEvent, waitFor } = testingLibrary();
    view = renderWithDom(React.createElement(RagSection, {
      onFeedback: (type, message) => feedbacks.push({ type, message }),
    }));
    const renderedView = view;

    await waitFor(() => {
      assert.equal(renderedView.getByText('indexed.pdf').textContent, 'indexed.pdf');
    });

    const corpusSelect = renderedView.container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(corpusSelect, { target: { value: 'corpus-1' } });
    fireEvent.click(renderedView.getByText('indexed.pdf'));

    await waitFor(() => {
      assert.equal(renderedView.getByText('加入所选资料集').textContent, '加入所选资料集');
    });

    fireEvent.click(renderedView.getByText('加入所选资料集'));

    await waitFor(() => {
      assert.deepEqual(updateCalls, [{ id: 'corpus-1', documentIds: ['doc-1'] }]);
      assert.ok(feedbacks.some((item) => item.type === 'success' && item.message === '文档已加入当前资料集'));
      assert.ok(renderedView.getAllByText('热力学教材 (1)').length >= 1);
      assert.equal(renderedView.getByText(/已归组 1/).textContent?.includes('已归组 1'), true);
      assert.equal(renderedView.getByText('热力学教材').textContent, '热力学教材');
      assert.equal(renderedView.getByText('从所选资料集移除').textContent, '从所选资料集移除');
    });

    fireEvent.click(renderedView.getByText('从所选资料集移除'));

    await waitFor(() => {
      assert.deepEqual(updateCalls, [
        { id: 'corpus-1', documentIds: ['doc-1'] },
        { id: 'corpus-1', documentIds: [] },
      ]);
      assert.ok(feedbacks.some((item) => item.type === 'success' && item.message === '文档已从资料集中移除'));
      assert.equal(renderedView.getByText('当前未归入任何资料集').textContent, '当前未归入任何资料集');
      assert.equal(renderedView.getByText('加入所选资料集').textContent, '加入所选资料集');
    });
  } finally {
    view?.unmount();
    ragModule.getStats = originalGetStats;
    ragModule.getCorpora = originalGetCorpora;
    ragModule.getDocuments = originalGetDocuments;
    ragModule.getDocument = originalGetDocument;
    ragModule.getChunks = originalGetChunks;
    ragModule.updateCorpus = originalUpdateCorpus;
  }
});
