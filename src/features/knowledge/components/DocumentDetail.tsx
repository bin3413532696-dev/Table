import React from 'react';
import { FileText, Hash, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { KnowledgeDocument, KnowledgeChunk, KnowledgeCorpus } from '../../../features/knowledge/types';
import * as api from '../../../features/knowledge/api/rag';

interface DocumentDetailProps {
  document: KnowledgeDocument;
  onClose: () => void;
  onReindex?: (id: string) => void;
  onAddToCorpus?: (id: string) => void;
  onRemoveFromCorpus?: (corpusId: string, documentId: string) => void;
  corpora?: KnowledgeCorpus[];
  currentCorpusId?: string;
  onSelectCorpus?: (corpusId: string) => void;
}

const fileTypeIcons: Record<string, string> = {
  pdf: '📄',
  md: '📝',
  txt: '📃',
  markdown: '📝',
};

export function DocumentDetail({
  document,
  onClose,
  onReindex,
  onAddToCorpus,
  onRemoveFromCorpus,
  corpora = [],
  currentCorpusId = '',
  onSelectCorpus,
}: DocumentDetailProps) {
  const [chunks, setChunks] = React.useState<KnowledgeChunk[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expandedChunkKey, setExpandedChunkKey] = React.useState<string | null>(null);
  const parentChunks = React.useMemo(
    () => chunks.filter((chunk) => chunk.chunkType === 'parent').sort((a, b) => a.chunkIndex - b.chunkIndex),
    [chunks],
  );
  const childChunks = React.useMemo(
    () => chunks.filter((chunk) => chunk.chunkType !== 'parent').sort((a, b) => a.chunkIndex - b.chunkIndex),
    [chunks],
  );
  const childChunksByParent = React.useMemo(() => {
    const groups = new Map<string, KnowledgeChunk[]>();
    for (const chunk of childChunks) {
      if (!chunk.parentId) continue;
      const current = groups.get(chunk.parentId) || [];
      current.push(chunk);
      groups.set(chunk.parentId, current);
    }
    return groups;
  }, [childChunks]);
  const childChunkCountByParent = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const chunk of childChunks) {
      if (!chunk.parentId) continue;
      counts.set(chunk.parentId, (counts.get(chunk.parentId) || 0) + 1);
    }
    return counts;
  }, [childChunks]);
  const orphanChildChunks = React.useMemo(
    () => childChunks.filter((chunk) => !chunk.parentId || !parentChunks.some((parent) => parent.id === chunk.parentId)),
    [childChunks, parentChunks],
  );
  const assignedCorpora = React.useMemo(
    () => corpora.filter((corpus) => document.corpusIds.includes(corpus.id)),
    [corpora, document.corpusIds],
  );
  const selectedCorpus = React.useMemo(
    () => corpora.find((corpus) => corpus.id === currentCorpusId) || null,
    [corpora, currentCorpusId],
  );
  const canAddToSelectedCorpus = Boolean(
    onAddToCorpus
      && selectedCorpus
      && !document.corpusIds.includes(selectedCorpus.id),
  );
  const canRemoveFromSelectedCorpus = Boolean(
    onRemoveFromCorpus
      && selectedCorpus
      && document.corpusIds.includes(selectedCorpus.id),
  );
  const toggleExpanded = React.useCallback((key: string) => {
    setExpandedChunkKey((current) => (current === key ? null : key));
  }, []);

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
  const renderChunkCard = (chunk: KnowledgeChunk, level: 'parent' | 'child' = 'child') => {
    const isParent = level === 'parent';
    const chunkKey = `${level}:${chunk.id}`;
    const isExpanded = expandedChunkKey === chunkKey;
    return (
      <div
        key={chunkKey}
        className={`border rounded-lg overflow-hidden ${isParent ? 'bg-amber-50/40' : 'bg-white'}`}
      >
        <button
          onClick={() => toggleExpanded(chunkKey)}
          className="w-full flex items-center justify-between p-3 hover:bg-gray-50 text-left"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">
              {isParent ? '父块' : '子块'} #{chunk.chunkIndex}
            </span>
            <span
              className={`px-1.5 py-0.5 text-xs rounded ${
                isParent ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
              }`}
            >
              {isParent ? '父块' : '子块'}
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
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          )}
        </button>

        {isExpanded && (
          <div className="px-4 pb-3 pt-2 bg-gray-50 border-t">
            <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-10">
              {chunk.content}
            </p>
            <div className="mt-2 space-y-1 text-xs text-gray-400">
              <p>Embedding: {chunk.embeddingModel || '未生成'}</p>
              {!isParent && chunk.parentId && (
                <p>父块 ID: {chunk.parentId}</p>
              )}
              {isParent && (
                <p>关联子块数: {childChunkCountByParent.get(chunk.id) || 0}</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
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

          {(onAddToCorpus || assignedCorpora.length > 0 || corpora.length > 0) && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">资料集归类</h3>
                {assignedCorpora.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {assignedCorpora.map((corpus) => (
                      <div
                        key={corpus.id}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-100 text-purple-700"
                      >
                        <span>{corpus.name}</span>
                        {onRemoveFromCorpus && (
                          <button
                            onClick={() => onRemoveFromCorpus(corpus.id, document.id)}
                            className="text-purple-700 hover:text-purple-900"
                            title={`从 ${corpus.name} 移除`}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">当前未归入任何资料集</p>
                )}
              </div>

              {onAddToCorpus && (
                corpora.length > 0 ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      value={currentCorpusId}
                      onChange={(e) => onSelectCorpus?.(e.target.value)}
                      className="input min-w-0"
                    >
                      <option value="">选择资料集</option>
                      {corpora.map((corpus) => (
                        <option key={corpus.id} value={corpus.id}>
                          {corpus.name} ({corpus.documentIds.length})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (canRemoveFromSelectedCorpus && selectedCorpus) {
                          onRemoveFromCorpus?.(selectedCorpus.id, document.id);
                          return;
                        }
                        onAddToCorpus?.(document.id);
                      }}
                      disabled={!canAddToSelectedCorpus && !canRemoveFromSelectedCorpus}
                      className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50"
                    >
                      {canRemoveFromSelectedCorpus
                        ? '从所选资料集移除'
                        : '加入所选资料集'}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">请先创建资料集，再对已有文档分类。</p>
                )
              )}
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
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 rounded bg-blue-50 text-blue-700">
                      子块 {childChunks.length}
                    </span>
                    <span className="px-2 py-1 rounded bg-amber-50 text-amber-700">
                      父块 {parentChunks.length}
                    </span>
                  </div>
                  {parentChunks.length > 0 && (
                    <div className="space-y-3">
                      {parentChunks.map((parentChunk) => {
                        const groupedChildren = childChunksByParent.get(parentChunk.id) || [];
                        return (
                          <div key={parentChunk.id} className="space-y-2">
                            {renderChunkCard(parentChunk, 'parent')}
                            {groupedChildren.length > 0 && (
                              <div className="ml-6 border-l-2 border-amber-100 pl-3 space-y-2">
                                {groupedChildren.map((childChunk) => renderChunkCard(childChunk, 'child'))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {orphanChildChunks.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-500">未归组子块</p>
                      {orphanChildChunks.map((chunk) => renderChunkCard(chunk, 'child'))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">暂无分块数据</p>
              )}
            </div>
          )}

          {/* Processing Status */}
          {document.status === 'pending' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
              <span className="ml-2 text-gray-600">排队中，等待处理...</span>
            </div>
          )}

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
          <div className="flex items-center gap-3">
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
    </div>
  );
}
