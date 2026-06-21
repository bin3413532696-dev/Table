import React from 'react';
import { FileText, Trash2, RefreshCw } from 'lucide-react';
import { MetadataBadges } from './MetadataFilter';
import type { KnowledgeDocument } from '../../../features/knowledge/types';

interface DocumentListProps {
  documents: KnowledgeDocument[];
  onDelete?: (id: string) => void;
  onReindex?: (id: string) => void;
  onSelect?: (doc: KnowledgeDocument) => void;
}

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

const fileTypeIcons: Record<string, string> = {
  pdf: '📄',
  md: '📝',
  txt: '📃',
  markdown: '📝',
};

export function DocumentList({ documents, onDelete, onReindex, onSelect }: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>暂无文档，上传文件开始使用</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {documents.map(doc => (
        <div
          key={doc.id}
          className="flex items-center justify-between p-4 bg-white border rounded-lg hover:bg-gray-50 cursor-pointer"
          onClick={() => onSelect?.(doc)}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{fileTypeIcons[doc.fileType || 'txt'] || '📄'}</span>
            <div>
              <p className="font-medium text-gray-900">{doc.title}</p>
              <p className="text-sm text-gray-500">
                {doc.fileSize > 1024 * 1024
                  ? `${(doc.fileSize / 1024 / 1024).toFixed(1)} MB`
                  : `${(doc.fileSize / 1024).toFixed(1)} KB`}
                {doc.source && ` · ${doc.source}`}
                {doc.corpusIds.length > 0 && ` · 已归组 ${doc.corpusIds.length}`}
              </p>
              <MetadataBadges doc={doc} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 text-xs rounded ${statusColors[doc.status]}`}>
              {statusLabels[doc.status]}
            </span>

            {doc.status === 'indexed' && onReindex && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReindex(doc.id);
                }}
                className="p-1 hover:bg-gray-100 rounded"
                title="重新索引"
              >
                <RefreshCw className="w-4 h-4 text-gray-500" />
              </button>
            )}

            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(doc.id);
                }}
                className="p-1 hover:bg-red-50 rounded"
                title="删除"
              >
                <Trash2 className="w-4 h-4 text-red-500" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
