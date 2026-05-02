import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, FileText, Clock, Trash2, AlertTriangle, Tag } from 'lucide-react';
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
      month: 'short',
      day: 'numeric',
    });
  };

  const getExcerpt = (content: string, maxLength = 60) => {
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
      {/* 头部操作区 */}
      <div className="p-4 border-b border-border-primary bg-bg-card">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={onCreate} className="btn btn-primary btn-md flex-1">
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
            className="input pl-10"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
              ×
            </button>
          )}
        </div>
        {notes.length > 0 && (
          <p className="text-xs text-text-muted mt-2">共 {notes.length} 条笔记</p>
        )}
      </div>

      {/* 删除确认对话框 */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="card w-full max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-error" />
                </div>
                <h3 className="font-semibold text-text-primary">确认删除</h3>
              </div>
              <p className="text-sm text-text-muted mb-5">
                确定要删除笔记 "{deleteConfirm.title || '无标题'}" 吗？此操作不可撤销。
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="btn btn-secondary btn-md flex-1">取消</button>
                <button onClick={handleConfirmDelete} className="btn btn-danger btn-md flex-1">删除</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 笔记列表 */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {filteredNotes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <FileText className="w-8 h-8 text-text-muted" />
            </div>
            <p className="empty-state-title">{search ? '未找到匹配的笔记' : '暂无笔记'}</p>
            {!search && <p className="empty-state-desc">点击上方按钮创建第一条笔记</p>}
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {filteredNotes.map((note, index) => (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.05, 0.3) }}
                onClick={() => onSelect(note)}
                className="group relative p-3 rounded-lg border border-border-primary hover:border-primary/30 hover:bg-bg-tertiary cursor-pointer transition-all duration-150"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-primary dark:text-primary-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-text-primary truncate text-sm">
                      {note.title || '无标题'}
                    </h3>
                    <p className="text-xs text-text-muted line-clamp-2 mt-1">
                      {getExcerpt(note.content) || '暂无内容'}
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-text-muted flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(note.updatedAt)}
                      </span>
                      {note.tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {note.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="badge badge-primary">
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
                    className="p-2 rounded-lg text-text-muted hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    title="删除笔记"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}