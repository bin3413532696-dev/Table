import React from 'react';
import { FileText, RefreshCw, Database, BarChart3, Loader2, Brain } from 'lucide-react';
import { DocumentUploader } from '../../KnowledgeRag/components/DocumentUploader';
import { DocumentList } from '../../KnowledgeRag/components/DocumentList';
import { DocumentDetail } from '../../KnowledgeRag/components/DocumentDetail';
import { HybridSearchBar } from '../../KnowledgeRag/components/HybridSearchBar';
import { SearchResults } from '../../KnowledgeRag/components/SearchResults';
import { IndexProgress } from '../../KnowledgeRag/components/IndexProgress';
import * as ragApi from '../../KnowledgeRag/api';
import type { KnowledgeDocument, SearchResult, SearchMode, RagStats } from '../../KnowledgeRag/types';

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
  const [loading, setLoading] = React.useState(false);
  const [selectedDoc, setSelectedDoc] = React.useState<KnowledgeDocument | null>(null);

  // 加载文档列表
  const loadDocuments = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await ragApi.getDocuments({ limit: 50 });
      setDocuments(result.items);
    } catch (err) {
      console.error('加载文档失败:', err);
      onFeedback?.('error', '加载文档失败');
    } finally {
      setLoading(false);
    }
  }, [onFeedback]);

  // 加载统计
  const loadStats = React.useCallback(async () => {
    try {
      const result = await ragApi.getStats();
      setStats(result);
    } catch (err) {
      console.error('加载统计失败:', err);
    }
  }, []);

  // 初始化加载
  React.useEffect(() => {
    loadDocuments();
    loadStats();
  }, [loadDocuments, loadStats]);

  // 上传成功后刷新
  const handleUploadSuccess = () => {
    loadDocuments();
    loadStats();
    onFeedback?.('success', '文档上传成功，正在索引');
  };

  // 删除文档
  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此文档？')) return;
    try {
      await ragApi.deleteDocument(id);
      loadDocuments();
      loadStats();
      onFeedback?.('success', '文档已删除');
    } catch (err) {
      console.error('删除失败:', err);
      onFeedback?.('error', '删除失败');
    }
  };

  // 重新索引
  const handleReindex = async (id: string) => {
    try {
      await ragApi.triggerIndex(id, true);
      loadDocuments();
      onFeedback?.('success', '已触发重新索引');
    } catch (err) {
      console.error('重新索引失败:', err);
      onFeedback?.('error', '重新索引失败');
    }
  };

  // 搜索
  const handleSearch = async (params: { query: string; mode: SearchMode }) => {
    setLoading(true);
    try {
      const result = await ragApi.search({
        query: params.query,
        mode: params.mode,
        limit: 20,
        threshold: 0.3,
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
            onClick={() => { loadDocuments(); loadStats(); }}
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
            <HybridSearchBar onSearch={handleSearch} disabled={loading} />

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
        />
      )}

      {/* Index Progress */}
      {documents.filter(d => d.status === 'processing').map(doc => (
        <div key={doc.id} className="fixed bottom-4 right-4 z-40">
          <IndexProgress
            documentId={doc.id}
            onComplete={() => { loadDocuments(); loadStats(); }}
          />
        </div>
      ))}
    </div>
  );
}