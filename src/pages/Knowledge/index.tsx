import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus,
  Tag,
  Save,
  Trash2,
  ArrowLeft,
  FileText,
  Settings,
} from 'lucide-react';
import { Button } from '../../components/ui';
import { NoteEditor } from './components/NoteEditor';
import { TagSelector } from './components/TagSelector';
import { NoteList } from './components/NoteList';
import type { KnowledgeNote, KnowledgePresetTag } from './types';
import * as api from './api';
import { MESSAGES } from '../../core/messages';

type ViewMode = 'list' | 'edit' | 'settings';

interface NoteFormData {
  title: string;
  content: string;
  tags: string[];
}

export default function KnowledgePage() {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [presetTags, setPresetTags] = useState<KnowledgePresetTag[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedNote, setSelectedNote] = useState<KnowledgeNote | null>(null);
  const [formData, setFormData] = useState<NoteFormData>({ title: '', content: '', tags: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [notesData, presetTagsData, allTagsData] = await Promise.all([
        api.getNoteList(),
        api.getPresetTagList(),
        api.getAllTags(),
      ]);
      setNotes(notesData);
      setPresetTags(presetTagsData);
      setAllTags(allTagsData);
    } catch (error) {
      showFeedback('error', MESSAGES.knowledge.loadDataFailed);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleCreateNote = () => {
    setSelectedNote(null);
    setFormData({ title: '', content: '', tags: [] });
    setViewMode('edit');
  };

  const handleEditNote = (note: KnowledgeNote) => {
    setSelectedNote(note);
    setFormData({
      title: note.title,
      content: note.content,
      tags: note.tags,
    });
    setViewMode('edit');
  };

  const handleSaveNote = async () => {
    if (!formData.title.trim()) {
      showFeedback('error', MESSAGES.knowledge.noteTitleRequired);
      return;
    }

    setIsSaving(true);
    try {
      if (selectedNote) {
        const updated = await api.updateNote(selectedNote.id, formData);
        if (updated) {
          setNotes(notes.map((n) => (n.id === updated.id ? updated : n)));
          showFeedback('success', MESSAGES.knowledge.noteUpdated);
        }
      } else {
        const created = await api.createNote(formData);
        setNotes([created, ...notes]);
        showFeedback('success', MESSAGES.knowledge.noteCreated);
      }
      const tags = await api.getAllTags();
      setAllTags(tags);
      setViewMode('list');
    } catch (error) {
      showFeedback('error', MESSAGES.knowledge.saveNoteFailed);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!selectedNote) return;

    if (!window.confirm('确定要删除这篇笔记吗？')) return;

    try {
      await api.deleteNote(selectedNote.id);
      setNotes(notes.filter((n) => n.id !== selectedNote.id));
      showFeedback('success', MESSAGES.knowledge.noteDeleted);
      setViewMode('list');
    } catch (error) {
      showFeedback('error', MESSAGES.knowledge.deleteNoteFailed);
    }
  };

  const handleCreatePresetTag = async (name: string, color: string) => {
    const created = await api.createPresetTag({ name, color });
    setPresetTags([...presetTags, created]);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg ${
              feedback.type === 'success'
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
            }`}
          >
            {feedback.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          {viewMode !== 'list' && (
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">知识库</h1>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'list' && (
            <>
              <Button onClick={handleCreateNote} className="flex items-center gap-2">
                <Plus size={18} />
                新建笔记
              </Button>
              <button
                type="button"
                onClick={() => setViewMode('settings')}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500"
              >
                <Settings size={20} />
              </button>
            </>
          )}
          {viewMode === 'edit' && (
            <div className="flex items-center gap-2">
              {selectedNote && (
                <button
                  type="button"
                  onClick={handleDeleteNote}
                  className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded-lg text-red-500"
                >
                  <Trash2 size={20} />
                </button>
              )}
              <Button onClick={handleSaveNote} disabled={isSaving} className="flex items-center gap-2">
                <Save size={18} />
                {isSaving ? '保存中...' : '保存'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'list' && (
          <NoteList
            notes={notes}
            onSelectNote={handleEditNote}
            presetTags={presetTags}
            allTags={allTags}
          />
        )}

        {viewMode === 'edit' && (
          <div className="max-w-3xl mx-auto space-y-4">
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="笔记标题"
              className="w-full text-2xl font-bold bg-transparent border-none focus:outline-none placeholder-gray-400"
            />
            <TagSelector
              selectedTags={formData.tags}
              onChange={(tags) => setFormData({ ...formData, tags })}
              presetTags={presetTags}
              allTags={allTags}
              onCreatePresetTag={handleCreatePresetTag}
            />
            <NoteEditor
              content={formData.content}
              onChange={(content) => setFormData({ ...formData, content })}
              placeholder="开始编写笔记..."
            />
          </div>
        )}

        {viewMode === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Tag size={20} />
                预设标签管理
              </h2>
              <div className="space-y-2">
                {presetTags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span>{tag.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (window.confirm(`确定要删除预设标签 "${tag.name}" 吗？`)) {
                          try {
                            await api.deletePresetTag(tag.id);
                            setPresetTags(presetTags.filter((t) => t.id !== tag.id));
                          } catch {
                            showFeedback('error', MESSAGES.knowledge.deletePresetTagFailed);
                          }
                        }
                      }}
                      className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {presetTags.length === 0 && (
                  <p className="text-gray-500 text-sm">{MESSAGES.knowledge.noPresetTags}</p>
                )}
              </div>
            </div>

            <div>
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <FileText size={20} />
                统计信息
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <div className="text-2xl font-bold">{notes.length}</div>
                  <div className="text-sm text-gray-500">知识笔记</div>
                </div>
                <div className="p-4 border rounded-lg">
                  <div className="text-2xl font-bold">{allTags.length}</div>
                  <div className="text-sm text-gray-500">已用标签</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
