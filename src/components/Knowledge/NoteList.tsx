import React, { useState, useMemo } from 'react';
import { Plus, Search, FileText, Clock } from 'lucide-react';
import { KnowledgeNote } from '../../db/knowledge';

interface NoteListProps {
  notes: KnowledgeNote[];
  onSelect: (note: KnowledgeNote) => void;
  onCreate: () => void;
}

export default function NoteList({ notes, onSelect, onCreate }: NoteListProps) {
  const [search, setSearch] = useState('');

  const filteredNotes = useMemo(() => {
    if (!search.trim()) return notes;
    const q = search.toLowerCase();
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        note.content.toLowerCase().includes(q)
    );
  }, [notes, search]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getExcerpt = (content: string, maxLength = 80) => {
    const text = content.replace(/[#*`\[\]]/g, '').trim();
    return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border-primary">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={onCreate}
            className="flex-1 py-2 px-4 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            新建笔记
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索笔记..."
            className="w-full pl-10 pr-4 py-2 border border-border-primary rounded-lg bg-bg-card text-sm focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filteredNotes.length === 0 ? (
          <div className="p-8 text-center text-text-muted">
            {search ? '未找到匹配的笔记' : '暂无笔记'}
          </div>
        ) : (
          <div className="divide-y divide-border-primary">
            {filteredNotes.map((note) => (
              <button
                key={note.id}
                onClick={() => onSelect(note)}
                className="w-full p-4 text-left hover:bg-bg-secondary transition-colors"
              >
                <div className="flex items-start gap-3">
                  <FileText className="w-5 h-5 text-text-muted mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-text-primary truncate">
                      {note.title || '无标题'}
                    </h3>
                    <p className="text-sm text-text-muted line-clamp-2 mt-1">
                      {getExcerpt(note.content) || '暂无内容'}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(note.updatedAt)}
                      </span>
                      {note.tags.length > 0 && (
                        <span className="px-2 py-0.5 bg-bg-tertiary rounded">
                          {note.tags[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}