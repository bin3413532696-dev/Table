import React, { useRef, useEffect } from 'react';
import { FileText, RefreshCw, Database, BarChart3, Loader2, Brain } from 'lucide-react';
import { DocumentUploader } from './DocumentUploader';
import { DocumentList } from './DocumentList';
import { DocumentDetail } from './DocumentDetail';
import { CorpusManager } from './CorpusManager';
import { HybridSearchBar } from './HybridSearchBar';
import { SearchResults } from './SearchResults';
import { IndexProgress } from './IndexProgress';
import { MetadataFilter } from './MetadataFilter';
import * as ragApi from '../api/rag';
import type { KnowledgeCorpus, KnowledgeDocument, SearchResult, SearchMode, RagStats, MetadataFilter as MetadataFilterType } from '../types';

type RagViewMode = 'documents' | 'search';

interface RagSectionProps {
  onFeedback?: (type: 'success' | 'error', message: string) => void;
}

export function RagSection({ onFeedback }: RagSectionProps) {
  const [viewMode, setViewMode] = React.useState<RagViewMode>('documents');
  const [documents, setDocuments] = React.useState<KnowledgeDocument[]>([]);
  const [searchResults, setSearchResults] = React.useState<SearchResult[]>([]);
  const [searchTimeMs, setSearchTimeMs] = React.useState<number>(0);
  const [stats, setStats] = React.useState<RagStats | null>(null);
  const [corpora, setCorpora] = React.useState<KnowledgeCorpus[]>([]);
  const [currentCorpusId, setCurrentCorpusId] = React.useState('');
  const [creatingCorpus, setCreatingCorpus] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [selectedDoc, setSelectedDoc] = React.useState<KnowledgeDocument | null>(null);
  const [metadataFilters, setMetadataFilters] = React.useState<MetadataFilterType>({});

  // 防抖：取消之前的请求，延迟执行
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const DEBOUNCE_DELAY = 300; // 300ms 防抖延迟

  // 加载文档列表（带防抖和请求取消）
  const loadDocumentsDebounced = React.useCallback(async (filters: MetadataFilterType) => {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    // 清除之前的防抖计时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // 创建新的 AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // 防抖延迟执行
    debounceTimerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await ragApi.getDocuments({
          limit: 50,
          ...(currentCorpusId
            ? { }
            : {}),
          publishDateRange: filters.publishDateRange,
          sourceDept: filters.sourceDept,
          securityLevel: filters.securityLevel,
          businessCategory: filters.businessCategory,
        });
        // 检查请求是否被取消
        if (!abortController.signal.aborted) {
          const nextItems = currentCorpusId
            ? result.items.filter((item) => item.corpusIds.includes(currentCorpusId))
            : result.items;
          setDocuments(nextItems);
        }
      } catch (err) {
        // 忽略取消错误
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('加载文档失败:', err);
        if (!abortController.signal.aborted) {
          onFeedback?.('error', '加载文档失败');
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_DELAY);
  }, [currentCorpusId, onFeedback]);

  // 当 metadataFilters 变化时，触发防抖加载
  useEffect(() => {
    loadDocumentsDebounced(metadataFilters);
    // 清理函数：组件卸载或下一次调用前取消请求
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [metadataFilters, loadDocumentsDebounced]);

  // 初始加载统计
  useEffect(() => {
    ragApi.getStats().then(setStats).catch(err => console.error('加载统计失败:', err));
    ragApi.getCorpora().then((result) => setCorpora(result.items)).catch(err => console.error('加载资料集失败:', err));
  }, []);

  // 存在 pending/processing 文档时，5s 周期性刷新列表（让异步 pipeline 的状态推进对用户可见）
  useEffect(() => {
    const hasActiveJob = documents.some(d => d.status === 'pending' || d.status === 'processing');
    if (!hasActiveJob) return;
    const timer = setInterval(() => {
      ragApi.getDocuments({
        limit: 50,
        publishDateRange: metadataFilters.publishDateRange,
        sourceDept: metadataFilters.sourceDept,
        securityLevel: metadataFilters.securityLevel,
        businessCategory: metadataFilters.businessCategory,
      }).then(result => {
        const nextItems = currentCorpusId
          ? result.items.filter((item) => item.corpusIds.includes(currentCorpusId))
          : result.items;
        setDocuments(nextItems);
        // 同步刷统计（索引完成数量会变）
        ragApi.getStats().then(setStats).catch(() => {});
      }).catch(err => console.error('轮询刷新文档失败:', err));
    }, 5000);
    return () => clearInterval(timer);
  }, [currentCorpusId, documents, metadataFilters]);

  // 立即刷新文档列表（不带防抖，用于手动操作）
  const refreshDocuments = async () => {
    setLoading(true);
    try {
      const result = await ragApi.getDocuments({
        limit: 50,
        publishDateRange: metadataFilters.publishDateRange,
        sourceDept: metadataFilters.sourceDept,
        securityLevel: metadataFilters.securityLevel,
        businessCategory: metadataFilters.businessCategory,
      });
      const nextItems = currentCorpusId
        ? result.items.filter((item) => item.corpusIds.includes(currentCorpusId))
        : result.items;
      setDocuments(nextItems);
      const corporaResult = await ragApi.getCorpora();
      setCorpora(corporaResult.items);
    } catch (err) {
      console.error('加载文档失败:', err);
      onFeedback?.('error', '加载文档失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCorpus = async (name: string) => {
    setCreatingCorpus(true);
    try {
      const created = await ragApi.createCorpus({ name });
      const corporaResult = await ragApi.getCorpora();
      setCorpora(corporaResult.items);
      setCurrentCorpusId(created.id);
      onFeedback?.('success', '资料集已创建');
    } catch (err) {
      console.error('创建资料集失败:', err);
      onFeedback?.('error', '创建资料集失败');
    } finally {
      setCreatingCorpus(false);
    }
  };

  const handleAttachDocumentToCurrentCorpus = async (documentId: string) => {
    if (!currentCorpusId) {
      onFeedback?.('error', '请先选择或创建资料集');
      return;
    }
    const currentCorpus = corpora.find((item) => item.id === currentCorpusId);
    if (!currentCorpus) {
      onFeedback?.('error', '当前资料集不存在');
      return;
    }
    const documentIds = Array.from(new Set([...currentCorpus.documentIds, documentId]));
    try {
      await ragApi.updateCorpus(currentCorpusId, { documentIds });
      const corporaResult = await ragApi.getCorpora();
      setCorpora(corporaResult.items);
      await refreshDocuments();
      if (selectedDoc?.id === documentId) {
        const refreshedDoc = await ragApi.getDocument(documentId);
        setSelectedDoc(refreshedDoc);
      }
      onFeedback?.('success', '文档已加入当前资料集');
    } catch (err) {
      console.error('加入资料集失败:', err);
      onFeedback?.('error', '加入资料集失败');
    }
  };

  const handleRemoveDocumentFromCorpus = async (corpusId: string, documentId: string) => {
    const targetCorpus = corpora.find((item) => item.id === corpusId);
    if (!targetCorpus) {
      onFeedback?.('error', '目标资料集不存在');
      return;
    }
    const documentIds = targetCorpus.documentIds.filter((id) => id !== documentId);
    try {
      await ragApi.updateCorpus(corpusId, { documentIds });
      const corporaResult = await ragApi.getCorpora();
      setCorpora(corporaResult.items);
      await refreshDocuments();
      if (selectedDoc?.id === documentId) {
        const refreshedDoc = await ragApi.getDocument(documentId);
        setSelectedDoc(refreshedDoc);
      }
      onFeedback?.('success', '文档已从资料集中移除');
    } catch (err) {
      console.error('移除资料集失败:', err);
      onFeedback?.('error', '移除资料集失败');
    }
  };

  // 刷新统计
  const refreshStats = async () => {
    try {
      const result = await ragApi.getStats();
      setStats(result);
    } catch (err) {
      console.error('加载统计失败:', err);
    }
  };

  // 上传成功后刷新
  const handleUploadSuccess = () => {
    refreshDocuments();
    refreshStats();
    onFeedback?.('success', '文档上传成功，正在索引');
  };

  // 删除文档
  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此文档？')) return;
    try {
      await ragApi.deleteDocument(id);
      refreshDocuments();
      refreshStats();
      onFeedback?.('success', '文档已删除');
    } catch (err) {
      console.error('删除失败:', err);
      onFeedback?.('error', '删除失败');
    }
  };

  // 重新索引
  const handleReindex = async (id: string) => {
    try {
      const result = await ragApi.triggerIndex(id, true);
      refreshDocuments();
      if (result.message) {
        onFeedback?.('success', result.message);
        return;
      }
      onFeedback?.('success', '已发起重新索引');
    } catch (err) {
      console.error('重新索引失败:', err);
      onFeedback?.('error', '重新索引失败');
    }
  };

  // 搜索
  const handleSearch = async (params: { query: string; mode: SearchMode; metadataFilters?: MetadataFilterType }) => {
    setLoading(true);
    try {
      const result = await ragApi.search({
        query: params.query,
        mode: params.mode,
        limit: 20,
        threshold: 0.3,
        publishDateRange: params.metadataFilters?.publishDateRange,
        sourceDept: params.metadataFilters?.sourceDept,
        securityLevel: params.metadataFilters?.securityLevel,
        businessCategory: params.metadataFilters?.businessCategory,
      });
      setSearchResults(result.results);
      setSearchTimeMs(result.searchTimeMs);
    } catch (err) {
      console.error('搜索失败:', err);
      onFeedback?.('error', '搜索失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header: Stats + Tabs */}
      <div className="px-4 py-3 border-b bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900">RAG 知识库</h2>
          </div>
          <button
            onClick={() => { refreshDocuments(); refreshStats(); }}
            className="p-1.5 hover:bg-gray-200 rounded"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex gap-3 mb-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-lg">
              <FileText className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-blue-700">{stats.documentCount}</span>
              <span className="text-xs text-gray-500">文档</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded-lg">
              <Database className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-green-700">{stats.indexedDocumentCount}</span>
              <span className="text-xs text-gray-500">已索引</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 rounded-lg">
              <BarChart3 className="w-4 h-4 text-purple-500" />
              <span className="text-sm font-medium text-purple-700">{stats.chunkWithEmbeddingCount}</span>
              <span className="text-xs text-gray-500">向量</span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 -mb-px">
          {[
            { key: 'documents', icon: FileText, label: '文档管理' },
            { key: 'search', icon: BarChart3, label: '检索测试' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setViewMode(tab.key as RagViewMode)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
                viewMode === tab.key
                  ? 'border-purple-600 text-purple-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'documents' && (
          <div className="space-y-4">
            {/* Upload */}
            <DocumentUploader onUploadSuccess={handleUploadSuccess} disabled={loading} />

            <CorpusManager
              corpora={corpora}
              currentCorpusId={currentCorpusId}
              creating={creatingCorpus}
              onSelectCorpus={setCurrentCorpusId}
              onCreateCorpus={handleCreateCorpus}
            />

            {/* Metadata Filter */}
            <MetadataFilter
              filters={metadataFilters}
              onChange={setMetadataFilters}
            />

            {/* Document List */}
            <div className="bg-white rounded-lg border p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                已上传文档 ({documents.length})
              </h3>
              {loading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
                  <p className="text-gray-500 mt-2">加载中...</p>
                </div>
              ) : (
                <DocumentList
                  documents={documents}
                  onDelete={handleDelete}
                  onReindex={handleReindex}
                  onSelect={setSelectedDoc}
                />
              )}
            </div>
          </div>
        )}

        {viewMode === 'search' && (
          <div className="space-y-4">
            {/* Metadata Filter */}
            <MetadataFilter
              filters={metadataFilters}
              onChange={setMetadataFilters}
            />

            <HybridSearchBar
              onSearch={(params) => handleSearch({ ...params, metadataFilters })}
              disabled={loading}
            />

            <div className="bg-white rounded-lg border p-4">
              {loading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
                  <p className="text-gray-500 mt-2">搜索中...</p>
                </div>
              ) : searchResults.length > 0 ? (
                <SearchResults
                  results={searchResults}
                  searchTimeMs={searchTimeMs}
                  onOpenDocument={(id: string) => {
                    const doc = documents.find(d => d.id === id);
                    if (doc) setSelectedDoc(doc);
                  }}
                />
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>输入搜索内容测试检索效果</p>
                  <p className="text-xs mt-1">支持语义、关键词、混合三种模式</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Document Detail Modal */}
      {selectedDoc && (
        <DocumentDetail
          document={selectedDoc}
          onClose={() => setSelectedDoc(null)}
          onReindex={handleReindex}
          onAddToCorpus={handleAttachDocumentToCurrentCorpus}
          onRemoveFromCorpus={handleRemoveDocumentFromCorpus}
          corpora={corpora}
          currentCorpusId={currentCorpusId}
          onSelectCorpus={setCurrentCorpusId}
        />
      )}

      {/* Index Progress */}
      {documents.filter(d => d.status === 'pending' || d.status === 'processing').map(doc => (
        <div key={doc.id} className="fixed bottom-4 right-4 z-40">
          <IndexProgress
            documentId={doc.id}
            onComplete={() => { refreshDocuments(); refreshStats(); }}
          />
        </div>
      ))}
    </div>
  );
}
