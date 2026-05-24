import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { SearchResult } from '../types';

interface SearchResultsProps {
  results: SearchResult[];
  searchTimeMs?: number;
  onOpenDocument?: (documentId: string) => void;
}

const sourceLabels: Record<string, string> = {
  semantic: '语义',
  keyword: '关键词',
  hybrid: '混合',
};

export function SearchResults({ results, searchTimeMs, onOpenDocument }: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>未找到相关结果</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {searchTimeMs && (
        <p className="text-sm text-gray-500">
          找到 {results.length} 条结果，耗时 {searchTimeMs}ms
        </p>
      )}

      {results.map((result) => (
        <div
          key={result.id}
          className="p-4 bg-white border rounded-lg hover:bg-gray-50"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900">
                {result.documentTitle}
              </span>
              <span className={`px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600`}>
                {sourceLabels[result.source]}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                相关度: {(result.score * 100).toFixed(1)}%
              </span>
              {onOpenDocument && (
                <button
                  onClick={() => onOpenDocument(result.documentId)}
                  className="p-1 hover:bg-gray-100 rounded"
                  title="查看文档"
                >
                  <ExternalLink className="w-4 h-4 text-gray-500" />
                </button>
              )}
            </div>
          </div>

          <p className="text-sm text-gray-700 line-clamp-3">
            {result.content}
          </p>
        </div>
      ))}
    </div>
  );
}