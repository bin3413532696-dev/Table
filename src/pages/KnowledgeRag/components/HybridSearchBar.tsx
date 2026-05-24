import React from 'react';
import { Search } from 'lucide-react';
import type { SearchMode } from '../types';

interface HybridSearchBarProps {
  onSearch: (params: { query: string; mode: SearchMode }) => void;
  disabled?: boolean;
}

export function HybridSearchBar({ onSearch, disabled }: HybridSearchBarProps) {
  const [query, setQuery] = React.useState('');
  const [mode, setMode] = React.useState<SearchMode>('hybrid');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch({ query: query.trim(), mode });
    }
  };

  const modeLabels: Record<SearchMode, string> = {
    hybrid: '混合',
    semantic: '语义',
    keyword: '关键词',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索知识库..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={disabled}
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          disabled={disabled || !query.trim()}
        >
          搜索
        </button>
      </div>

      <div className="flex gap-2">
        {(Object.keys(modeLabels) as SearchMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1 text-sm rounded-lg transition-colors
              ${mode === m
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            {modeLabels[m]}
          </button>
        ))}
      </div>
    </form>
  );
}