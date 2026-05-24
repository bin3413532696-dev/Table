import React from 'react';
import { FileText, Hash, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { KnowledgeDocument, KnowledgeChunk } from '../types';
import * as api from '../api';

interface DocumentDetailProps {
  document: KnowledgeDocument;
  onClose: () => void;
  onReindex?: (id: string) => void;
}

const fileTypeIcons: Record<string, string> = {
  pdf: '📄',
  md: '📝',
  txt: '📃',
  markdown: '📝',
};

export function DocumentDetail({ document, onClose, onReindex }: DocumentDetailProps) {
  const [chunks, setChunks] = React.useState<KnowledgeChunk[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expandedChunk, setExpandedChunk] = React.useState<number | null>(null);

  const loadChunks = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getChunks(document.id, { limit: 100 });
      setChunks(result.items);
    } catch (err) {
      console.error('加载分块失败:', err);
    } finally {
      setLoading(false);
    }
  }, [document.id]);

  React.useEffect(() => {
    if (document.status === 'indexed') {
      loadChunks();
    } else {
      setLoading(false);
    }
  }, [document.id, document.status, loadChunks]);

  const statusLabels: Record<string, string> = {
    pending: '待处理',
    processing: '处理中',
    indexed: '已索引',
    failed: '失败',
    deleted: '已删除',
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    processing: 'bg-blue-100 text-blue-700',
    indexed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    deleted: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{fileTypeIcons[document.fileType || 'txt'] || '📄'}</span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{document.title}</h2>
              <p className="text-sm text-gray-500">
                {document.source && `${document.source} · `}
                {(document.fileSize / 1024).toFixed(1)} KB · {document.tags.length > 0 ? document.tags.join(', ') : '无标签'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 text-xs rounded ${statusColors[document.status]}`}>
              {statusLabels[document.status]}
            </span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Summary */}
          {document.summary && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">摘要</h3>
              <p className="text-sm text-gray-600">{document.summary}</p>
            </div>
          )}

          {/* Chunks Section */}
          {document.status === 'indexed' && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                <Hash className="w-4 h-4" />
                分块列表 ({chunks.length} 个)
              </h3>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : chunks.length > 0 ? (
                <div className="space-y-2">
                  {chunks.map((chunk) => (
                    <div
                      key={chunk.id}
                      className="border rounded-lg overflow-hidden"
                    >
                      <button
                        onClick={() => setExpandedChunk(expandedChunk === chunk.chunkIndex ? null : chunk.chunkIndex)}
                        className="w-full flex items-center justify-between p-3 hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-700">
                            分块 #{chunk.chunkIndex}
                          </span>
                          <span className="text-xs text-gray-500">
                            {chunk.startPos}-{chunk.endPos} 字符
                          </span>
                          {chunk.hasEmbedding && (
                            <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                              向量化
                            </span>
                          )}
                        </div>
                        {expandedChunk === chunk.chunkIndex ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </button>

                      {expandedChunk === chunk.chunkIndex && (
                        <div className="px-4 pb-3 pt-2 bg-gray-50 border-t">
                          <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-10">
                            {chunk.content}
                          </p>
                          <p className="text-xs text-gray-400 mt-2">
                            Embedding: {chunk.embeddingModel || '未生成'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">暂无分块数据</p>
              )}
            </div>
          )}

          {/* Processing Status */}
          {document.status === 'processing' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="ml-2 text-gray-600">正在索引处理...</span>
            </div>
          )}

          {document.status === 'failed' && (
            <div className="bg-red-50 rounded-lg p-4 text-red-700">
              索引失败，请重试
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex justify-between">
          <div className="text-xs text-gray-500">
            创建: {new Date(document.createdAt).toLocaleString()}
            · 更新: {new Date(document.updatedAt).toLocaleString()}
          </div>
          {onReindex && document.status === 'indexed' && (
            <button
              onClick={() => onReindex(document.id)}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              重新索引
            </button>
          )}
        </div>
      </div>
    </div>
  );
}