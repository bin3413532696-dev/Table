import React, { useState, useMemo } from 'react';
import { Plus, Search, FileText, Clock, Trash2, X } from 'lucide-react';
import { KnowledgeNote } from '../../db/knowledge';

interface NoteListProps {
  notes: KnowledgeNote[];
  onSelect: (note: KnowledgeNote) => void;
  onCreate: () => void;
  onDelete: (note: KnowledgeNote) => void;
}

export default function NoteList({ notes, onSelect, onCreate, onDelete }: NoteListProps) {
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<KnowledgeNote | null>(null);

  // 按更新时间降序排列
  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (!search.trim()) return sortedNotes;
    const q = search.toLowerCase();
    return sortedNotes.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        note.content.toLowerCase().includes(q) ||
        note.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }, [sortedNotes, search]);

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

  const handleDeleteClick = (e: React.MouseEvent, note: KnowledgeNote) => {
    e.stopPropagation();
    setDeleteConfirm(note);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm) {
      onDelete(deleteConfirm);
      setDeleteConfirm(null);
    }
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
            placeholder="搜索笔记标题、内容或标签..."
            className="w-full pl-10 pr-4 py-2 border border-border-primary rounded-lg bg-bg-card text-sm focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* 删除确认对话框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-card rounded-lg p-4 max-w-sm mx-4 border border-border-primary">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 className="w-5 h-5 text-rose-500" />
              <h3 className="font-medium">确认删除</h3>
            </div>
            <p className="text-sm text-text-muted mb-4">
              确定要删除笔记 "{deleteConfirm.title || '无标题'}" 吗？此操作不可撤销。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-bg-secondary"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-sm bg-rose-500 text-white rounded-lg hover:bg-rose-600"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {filteredNotes.length === 0 ? (
          <div className="p-8 text-center text-text-muted">
            {search ? '未找到匹配的笔记' : '暂无笔记'}
          </div>
        ) : (
          <div className="divide-y divide-border-primary">
            {filteredNotes.map((note) => (
              <div
                key={note.id}
                onClick={() => onSelect(note)}
                className="w-full p-4 text-left hover:bg-bg-secondary transition-colors cursor-pointer group"
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
                        <div className="flex gap-1">
                          {note.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="px-2 py-0.5 bg-bg-tertiary rounded text-xs">
                              {tag}
                            </span>
                          ))}
                          {note.tags.length > 2 && (
                            <span className="text-text-muted">+{note.tags.length - 2}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteClick(e, note)}
                    className="p-1.5 rounded hover:bg-rose-100 dark:hover:bg-rose-900/20 text-text-muted hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除笔记"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}