import React, { useState } from 'react';
import { Search, Filter, X, Tag } from 'lucide-react';
import type { KnowledgeNote, KnowledgePresetTag } from '../types';

interface NoteListProps {
  notes: KnowledgeNote[];
  onSelectNote: (note: KnowledgeNote) => void;
  presetTags: KnowledgePresetTag[];
  allTags: string[];
}

export function NoteList({ notes, onSelectNote, presetTags, allTags }: NoteListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);

  const filteredNotes = notes.filter((note) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const titleMatch = note.title.toLowerCase().includes(query);
      const contentMatch = note.content.toLowerCase().includes(query);
      if (!titleMatch && !contentMatch) {
        return false;
      }
    }
    if (selectedFilterTags.length > 0) {
      const hasAllTags = selectedFilterTags.every((tag) => note.tags.includes(tag));
      if (!hasAllTags) {
        return false;
      }
    }
    return true;
  });

  const handleTagFilterClick = (tag: string) => {
    if (selectedFilterTags.includes(tag)) {
      setSelectedFilterTags(selectedFilterTags.filter((t) => t !== tag));
    } else {
      setSelectedFilterTags([...selectedFilterTags, tag]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索笔记..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTagFilter(!showTagFilter)}
          className={`p-2 rounded-lg border transition-colors ${
            showTagFilter || selectedFilterTags.length > 0
              ? 'bg-blue-50 border-blue-300 text-blue-600'
              : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Filter size={18} />
        </button>
      </div>

      {showTagFilter && (
        <div className="p-3 border rounded-lg bg-gray-50 dark:bg-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <Tag size={14} className="text-gray-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">标签筛选</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {presetTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleTagFilterClick(tag.name)}
                className={`px-2 py-1 rounded-full text-sm font-medium transition-colors ${
                  selectedFilterTags.includes(tag.name)
                    ? 'ring-2 ring-offset-1'
                    : 'opacity-70 hover:opacity-100'
                }`}
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                }}
              >
                {tag.name}
              </button>
            ))}
            {allTags.filter((tag) => !presetTags.some((p) => p.name === tag)).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleTagFilterClick(tag)}
                className={`px-2 py-1 rounded-full text-sm font-medium transition-colors ${
                  selectedFilterTags.includes(tag)
                    ? 'bg-gray-200 dark:bg-gray-600 ring-2 ring-gray-400 ring-offset-1'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 opacity-70 hover:opacity-100'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
          {selectedFilterTags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedFilterTags([])}
              className="mt-2 text-sm text-blue-600 hover:text-blue-700"
            >
              清除筛选
            </button>
          )}
        </div>
      )}

      {filteredNotes.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {notes.length === 0 ? '暂无笔记，点击上方按钮创建第一篇笔记' : '没有找到匹配的笔记'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              onClick={() => onSelectNote(note)}
              className="group cursor-pointer p-4 border rounded-lg hover:border-blue-300 hover:shadow-sm transition-all bg-white dark:bg-gray-900"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600">
                    {note.title}
                  </h3>
                  {note.content && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {note.content.replace(/<[^>]*>/g, '').replace(/\n/g, ' ').slice(0, 120)}
                      {note.content.length > 120 && '...'}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {note.tags.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <Tag size={12} className="text-gray-400" />
                        {note.tags.slice(0, 3).map((tag) => {
                          const preset = presetTags.find((p) => p.name === tag);
                          return (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 rounded text-xs font-medium"
                              style={{
                                backgroundColor: preset ? `${preset.color}20` : '#6B728020',
                                color: preset ? preset.color : '#6B7280',
                              }}
                            >
                              {tag}
                            </span>
                          );
                        })}
                        {note.tags.length > 3 && (
                          <span className="text-xs text-gray-400">+{note.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-gray-400 ml-auto">
                      {new Date(note.updatedAt).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
