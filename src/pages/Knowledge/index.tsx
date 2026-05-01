import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, ArrowLeft, Save, Search, Network, MessageSquare, Loader2 } from 'lucide-react';
import { KnowledgeNote, noteOperations } from '../../db/knowledge';
import PKMEditor from '../../components/Editor/PKMEditor';
import { NoteList, BacklinksPanel } from '../../components/Knowledge';
import { GraphView, buildGraphData } from '../../components/Graph';
import { AIChatPanel } from '../../components/AI';
import { initEmbedder, isLoaded } from '../../lib/embeddings';
import { initVectorStore, searchVectors, addDocument, reindexAll, getIndexedCount } from '../../lib/vectorStore';

type ViewMode = 'editor' | 'graph' | 'ai';

export default function Knowledge() {
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<KnowledgeNote | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [backlinks, setBacklinks] = useState<KnowledgeNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  const [embedderReady, setEmbedderReady] = useState(false);
  const [embedderLoading, setEmbedderLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; text: string; score: number }>>([]);
  const [indexedCount, setIndexedCount] = useState(0);

  const loadNotes = useCallback(async () => {
    const allNotes = await noteOperations.getAll();
    setNotes(allNotes);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadNotes();
    initVectorStore();
  }, [loadNotes]);

  useEffect(() => {
    if (selectedNote) {
      noteOperations.findBacklinks(selectedNote.id).then(setBacklinks);
    } else {
      setBacklinks([]);
    }
  }, [selectedNote]);

  useEffect(() => {
    getIndexedCount().then(setIndexedCount);
  }, [notes]);

  const handleInitEmbedder = useCallback(async () => {
    setEmbedderLoading(true);
    try {
      await initEmbedder();
      setEmbedderReady(true);
    } catch (e) {
      console.error('Failed to init embedder:', e);
    } finally {
      setEmbedderLoading(false);
    }
  }, []);

  const handleReindex = useCallback(async () => {
    setEmbedderLoading(true);
    try {
      await initEmbedder();
      await reindexAll(notes.map((n) => ({ id: n.id, text: n.content })), (current, total) => {
        console.log(`Indexed ${current}/${total}`);
      });
      setIndexedCount(notes.length);
    } catch (e) {
      console.error('Failed to reindex:', e);
    } finally {
      setEmbedderLoading(false);
    }
  }, [notes]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !embedderReady) return;
    try {
      const results = await searchVectors(searchQuery, 10);
      setSearchResults(results);
    } catch (e) {
      console.error('Search failed:', e);
    }
  }, [searchQuery, embedderReady]);

  const handleCreateNote = useCallback(async () => {
    const id = await noteOperations.create({
      title: '新笔记',
      content: '# 新笔记\n\n开始书写...',
      tags: [],
    });
    await loadNotes();
    const newNote = await noteOperations.getById(id);
    if (newNote) {
      setSelectedNote(newNote);
      setEditContent(newNote.content);
      setIsEditing(true);
      if (embedderReady) {
        await addDocument({ id: newNote.id, text: newNote.content });
        setIndexedCount((c) => c + 1);
      }
    }
  }, [loadNotes, embedderReady]);

  const handleSelectNote = useCallback((note: KnowledgeNote) => {
    setSelectedNote(note);
    setEditContent(note.content);
    setIsEditing(false);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedNote) return;
    await noteOperations.update(selectedNote.id, { content: editContent });

    const titleMatch = editContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : selectedNote.title;
    if (title !== selectedNote.title) {
      await noteOperations.update(selectedNote.id, { title });
    }

    await loadNotes();
    const updated = await noteOperations.getById(selectedNote.id);
    if (updated) setSelectedNote(updated);
    setIsEditing(false);
  }, [selectedNote, editContent, loadNotes]);

  const handleCancelEdit = useCallback(() => {
    if (selectedNote) {
      setEditContent(selectedNote.content);
    }
    setIsEditing(false);
  }, [selectedNote]);

  const handleNavigateToBacklink = useCallback((noteId: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (note) {
      setSelectedNote(note);
      setEditContent(note.content);
      setIsEditing(false);
    }
  }, [notes]);

  const handleNodeClick = useCallback((nodeId: string) => {
    const note = notes.find((n) => n.id === nodeId);
    if (note) {
      setSelectedNote(note);
      setEditContent(note.content);
      setIsEditing(false);
    }
  }, [notes]);

  const { nodes, links } = buildGraphData(notes);

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 md:mb-8"
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-900 dark:bg-gray-700 rounded-lg flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-text-primary">知识库</h1>
              <p className="text-sm text-text-muted">本地笔记 + 语义搜索 + AI 对话</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {embedderReady ? (
              <span className="text-xs text-green-600 dark:text-green-400">
                向量索引: {indexedCount}/{notes.length}
              </span>
            ) : embedderLoading ? (
              <span className="text-xs text-text-muted flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                加载中...
              </span>
            ) : (
              <button
                onClick={handleInitEmbedder}
                className="text-xs px-2 py-1 bg-primary text-white rounded"
              >
                启用语义搜索
              </button>
            )}
            {embedderReady && notes.length > 0 && (
              <button
                onClick={handleReindex}
                className="text-xs px-2 py-1 border border-border-primary rounded hover:bg-bg-secondary"
              >
                重建索引
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {embedderReady && (
        <div className="mb-4 flex gap-2 items-center">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="语义搜索笔记..."
            className="flex-1 max-w-xs px-3 py-2 border border-border-primary rounded-lg text-sm bg-bg-card"
          />
          <button onClick={handleSearch} className="px-3 py-2 bg-primary text-white rounded-lg text-sm">
            搜索
          </button>
          {searchResults.length > 0 && (
            <div className="flex-1 text-sm text-text-muted">
              找到 {searchResults.length} 条相关结果
            </div>
          )}
        </div>
      )}

      {searchResults.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 bg-bg-card border border-border-primary rounded-lg"
        >
          <h3 className="text-sm font-medium mb-2">搜索结果</h3>
          <div className="space-y-2">
            {searchResults.map((result) => {
              const note = notes.find((n) => n.id === result.id);
              return (
                <button
                  key={result.id}
                  onClick={() => note && handleSelectNote(note)}
                  className="w-full text-left p-2 bg-bg-secondary rounded hover:bg-bg-tertiary"
                >
                  <div className="text-sm font-medium">{note?.title || result.id}</div>
                  <div className="text-xs text-text-muted">
                    相关度: {(result.score * 100).toFixed(0)}% - {result.text.slice(0, 60)}...
                  </div>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6" style={{ height: 'calc(100vh - 220px)' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl shadow-sm border bg-bg-card border-border-primary overflow-hidden"
        >
          <NoteList notes={notes} onSelect={handleSelectNote} onCreate={handleCreateNote} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-2 rounded-xl shadow-sm border bg-bg-card border-border-primary overflow-hidden flex flex-col"
        >
          {selectedNote ? (
            <>
              <div className="p-4 border-b border-border-primary flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setSelectedNote(null); setIsEditing(false); }}
                    className="p-2 hover:bg-bg-secondary rounded-lg transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <h2 className="font-medium text-text-primary">
                    {selectedNote.title || '无标题'}
                  </h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setViewMode('editor')}
                    className={`p-2 rounded-lg transition-colors ${viewMode === 'editor' ? 'bg-primary text-white' : 'hover:bg-bg-secondary'}`}
                  >
                    <Save className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('graph')}
                    className={`p-2 rounded-lg transition-colors ${viewMode === 'graph' ? 'bg-primary text-white' : 'hover:bg-bg-secondary'}`}
                  >
                    <Network className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('ai')}
                    className={`p-2 rounded-lg transition-colors ${viewMode === 'ai' ? 'bg-primary text-white' : 'hover:bg-bg-secondary'}`}
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-bg-secondary ml-2"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSave}
                        className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg flex items-center gap-1"
                      >
                        保存
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleEdit}
                      className="px-4 py-1.5 bg-primary text-white rounded-lg text-sm ml-2"
                    >
                      编辑
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                {viewMode === 'editor' && (
                  isEditing ? (
                    <div className="h-full">
                      <PKMEditor
                        content={editContent}
                        onChange={setEditContent}
                        notes={notes.map((n) => ({ id: n.id, title: n.title }))}
                      />
                    </div>
                  ) : (
                    <div className="p-6 prose prose-slate dark:prose-invert max-w-none h-full overflow-auto">
                      <pre className="whitespace-pre-wrap text-sm">{selectedNote.content}</pre>
                    </div>
                  )
                )}
                {viewMode === 'graph' && (
                  <GraphView
                    nodes={nodes}
                    links={links}
                    onNodeClick={handleNodeClick}
                    width={600}
                    height={400}
                  />
                )}
                {viewMode === 'ai' && (
                  <AIChatPanel notes={notes} />
                )}
              </div>

              {!isEditing && (
                <div className="p-4 border-t border-border-primary">
                  <BacklinksPanel
                    backlinks={backlinks.map((bl) => ({
                      sourceId: bl.id,
                      sourceTitle: bl.title,
                      context: bl.content.slice(0, 100) + '...',
                    }))}
                    onNavigate={handleNavigateToBacklink}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted">
              <div className="text-center">
                <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>选择或创建一个笔记开始</p>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}