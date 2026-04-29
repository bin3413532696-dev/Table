import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, Command, PanelLeft, PanelRight, X } from 'lucide-react';
import { FileTree } from './components/FileTree';
import { Editor } from './components/Editor';
import { Backlinks } from './components/Backlinks';
import { TagCloud } from './components/TagCloud';
import { GraphView } from './components/GraphView';
import { CommandPalette } from './components/CommandPalette';
import { noteDB, folderDB, Note, Folder, createUseDB } from '../../db';
import { useNotesLayout } from './hooks/useNotesLayout';
import { useNotesSearch } from './hooks/useNotesSearch';
import Loading from '../../components/Loading';

type RightPanelType = 'backlinks' | 'tags' | 'graph';
type EditorMode = 'edit' | 'split' | 'preview';

const useDB = createUseDB(React);

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanelType>('backlinks');
  const [isVimMode, setIsVimMode] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const {
    leftWidth, rightWidth, leftCollapsed, rightCollapsed,
    setLeftCollapsed, setRightCollapsed,
    leftResizeRef, rightResizeRef,
    startResizeLeft, startResizeRight,
  } = useNotesLayout();

  const { searchQuery, isSearching, setSearchQuery, setIsSearching, handleSearch }
    = useNotesSearch(setNotes);

  const { data } = useDB(async () => {
    const [allNotes, allFolders] = await Promise.all([
      noteDB.getAll(),
      folderDB.getAll()
    ]);
    return { allNotes, allFolders };
  }, []);

  useEffect(() => {
    if (data && loading) {
      setNotes(data.allNotes);
      setFolders(data.allFolders);
      setLoading(false);
    }
  }, [data, loading]);

  const reloadData = useCallback(async () => {
    const [allNotes, allFolders] = await Promise.all([
      noteDB.getAll(),
      folderDB.getAll()
    ]);
    setNotes(allNotes);
    setFolders(allFolders);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCreateNote = useCallback(async (folderId: string | null = null) => {
    const newNote = await noteDB.add({
      title: '未命名笔记',
      content: '',
      folderId,
      tags: [],
      links: [],
      backlinks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    setNotes(prev => [newNote, ...prev]);
    setCurrentNote(newNote);
    setSelectedFolderId(null);
  }, []);

  const handleUpdateNote = useCallback(async (content: string) => {
    if (!currentNote) return;

    const linkRegex = /\[\[([^\]]+)\]\]/g;
    const linkTexts: string[] = [];
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      linkTexts.push(match[1]);
    }

    const links: string[] = [];
    const processedIds = new Set<string>();

    for (const linkText of linkTexts) {
      let targetNote: Note | undefined;

      if (linkText.length > 10 && !linkText.includes(' ')) {
        targetNote = notes.find(n => n.id === linkText);
      }

      if (!targetNote) {
        targetNote = notes.find(n => n.title === linkText);
      }

      if (targetNote && !processedIds.has(targetNote.id)) {
        links.push(targetNote.id);
        processedIds.add(targetNote.id);
      }
    }

    const oldLinks = currentNote.links || [];
    const removedLinks = oldLinks.filter(l => !links.includes(l));
    const addedLinks = links.filter(l => !oldLinks.includes(l));
    const affectedIds = new Set([...removedLinks, ...addedLinks]);

    // Only update if something changed
    const contentChanged = currentNote.content !== content;
    const linksChanged = affectedIds.size > 0;

    if (!contentChanged && !linksChanged) return;

    await noteDB.update(currentNote.id, { content });
    if (linksChanged) {
      await noteDB.updateLinks(currentNote.id, links);
    }

    setNotes(prev => {
      if (!linksChanged) {
        return prev.map(n => n.id === currentNote.id ? { ...n, content } : n);
      }

      return prev.map(n => {
        if (n.id === currentNote.id) {
          return { ...n, content, links };
        }
        if (removedLinks.includes(n.id)) {
          return { ...n, backlinks: (n.backlinks || []).filter(b => b !== currentNote.id) };
        }
        if (addedLinks.includes(n.id)) {
          return { ...n, backlinks: [...(n.backlinks || []), currentNote.id] };
        }
        return n;
      });
    });

    setCurrentNote(prev => prev ? { ...prev, content, links } : null);
  }, [currentNote, notes]);

  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUpdateTitle = useCallback((title: string) => {
    if (!currentNote) return;

    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current);
    }

    titleTimerRef.current = setTimeout(async () => {
      if (!currentNote) return;
      const oldTitle = currentNote.title;

      // Update note title
      await noteDB.update(currentNote.id, { title });

      // Update links in other notes that reference this note by title
      if (oldTitle !== title) {
        const linkRegex = /\[\[([^\]]+)\]\]/g;
        const updatedNotes: Note[] = [];

        for (const note of notes) {
          if (note.id === currentNote.id) continue;

          let newContent = note.content;
          let hasChanges = false;

          // Replace [[oldTitle]] with [[title]] in content
          newContent = newContent.replace(linkRegex, (match, linkText) => {
            if (linkText === oldTitle) {
              hasChanges = true;
              return `[[${title}]]`;
            }
            return match;
          });

          if (hasChanges) {
            await noteDB.update(note.id, { content: newContent });
            updatedNotes.push({ ...note, content: newContent });
          }
        }

        // Refresh notes to get updated content
        if (updatedNotes.length > 0) {
          reloadData();
        }
      }

      setNotes(prev => prev.map(n => n.id === currentNote.id ? { ...n, title } : n));
      setCurrentNote(prev => prev ? { ...prev, title } : null);
    }, 500);
  }, [currentNote, notes, reloadData]);

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    await noteDB.delete(noteId);
    reloadData();
  }, [reloadData]);

  const handleNotesChanged = useCallback((updatedNotes: Note[]) => {
    if (!isSearching) setNotes(updatedNotes);
  }, [isSearching]);

  const handleFoldersChanged = useCallback((updatedFolders: Folder[]) => {
    setFolders(updatedFolders);
  }, []);

  useEffect(() => {
    if (currentNote && !notes.find(n => n.id === currentNote.id)) {
      setCurrentNote(null);
    }
  }, [notes, currentNote]);

  const filteredNotes = selectedTags.length > 0
    ? notes.filter(n => selectedTags.some(tag => n.tags?.includes(tag)))
    : notes;


  if (loading) {
    return <Loading />;
  }

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border-primary bg-bg-primary/80 backdrop-blur-xl">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLeftCollapsed(!leftCollapsed)}
            className={`p-2 rounded-lg transition-colors ${
              leftCollapsed ? 'bg-bg-tertiary text-text-primary' : 'hover:bg-bg-tertiary text-text-secondary'
            }`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          {isSearching ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索笔记..."
                className="px-3 py-1.5 text-sm rounded-lg outline-none w-64 bg-bg-tertiary text-text-primary placeholder-text-muted"
                autoFocus
              />
              <button
                onClick={handleSearch}
                className="p-2 rounded-lg transition-colors hover:bg-bg-tertiary text-text-secondary"
              >
                <Search className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsSearching(false);
                  setSearchQuery('');
                  reloadData();
                }}
                className="p-2 rounded-lg transition-colors hover:bg-bg-tertiary text-text-secondary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setIsSearching(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors hover:bg-bg-tertiary text-text-secondary"
              >
                <Search className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsCommandPaletteOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors hover:bg-bg-tertiary text-text-secondary"
              >
                <Command className="w-4 h-4" />
                <span className="text-xs px-1.5 py-0.5 rounded-md bg-bg-tertiary text-text-muted border border-border-primary">⌘K</span>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {currentNote && (
            <input
              type="text"
              value={currentNote.title}
              onChange={(e) => handleUpdateTitle(e.target.value)}
              className="px-3 py-1.5 text-sm font-medium rounded-lg outline-none transition-colors bg-transparent text-text-primary hover:bg-bg-tertiary focus:bg-bg-tertiary text-center"
            />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg bg-bg-tertiary p-0.5">
            {(['backlinks', 'tags', 'graph'] as RightPanelType[]).map((panel, i) => (
              <button
                key={panel}
                onClick={() => {
                  if (rightCollapsed) setRightCollapsed(false);
                  setRightPanel(panel);
                }}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  rightPanel === panel && !rightCollapsed
                    ? 'bg-bg-card text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-secondary'
                }`}
              >
                {panel === 'backlinks' && '反向链接'}
                {panel === 'tags' && '标签'}
                {panel === 'graph' && '图谱'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setRightCollapsed(!rightCollapsed)}
            className={`p-2 rounded-lg transition-colors ${
              rightCollapsed ? 'bg-bg-tertiary text-text-primary' : 'hover:bg-bg-tertiary text-text-secondary'
            }`}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {!leftCollapsed && (
          <>
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: leftWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-r overflow-hidden border-border-primary bg-bg-card"
            >
              <FileTree
                folders={folders}
                notes={filteredNotes}
                selectedNoteId={currentNote?.id || null}
                selectedFolderId={selectedFolderId}
                onSelectNote={setCurrentNote}
                onSelectFolder={setSelectedFolderId}
                onCreateNote={handleCreateNote}
                onDeleteNote={handleDeleteNote}
                onNotesChanged={handleNotesChanged}
                onFoldersChanged={handleFoldersChanged}
              />
            </motion.div>
            <div
              ref={leftResizeRef}
              onMouseDown={startResizeLeft}
              className="w-1 cursor-col-resize hover:w-1.5 hover:bg-blue-400 transition-all bg-bg-tertiary shrink-0"
            />
          </>
        )}

        <div className="flex-1 overflow-hidden">
          {currentNote ? (
            <Editor
              content={currentNote.content}
              onChange={handleUpdateNote}
              isVimMode={isVimMode}
              onToggleVim={() => setIsVimMode(!isVimMode)}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="w-20 h-20 rounded-2xl mb-5 flex items-center justify-center bg-bg-card shadow-sm border border-border-primary">
                <Search className="w-8 h-8 text-text-muted" />
              </div>
              <p className="text-base font-medium text-text-secondary mb-1">选择一个笔记开始编辑</p>
              <p className="text-sm text-text-muted mb-6">或者创建一个新笔记</p>
              <button
                onClick={() => handleCreateNote()}
                className="px-5 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-900 hover:bg-gray-800 text-white dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                新建笔记
              </button>
            </div>
          )}
        </div>

        {!rightCollapsed && (
          <>
            <div
              ref={rightResizeRef}
              onMouseDown={startResizeRight}
              className="w-1 cursor-col-resize hover:w-1.5 hover:bg-blue-400 transition-all bg-bg-tertiary shrink-0"
            />
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: rightWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-l overflow-hidden border-border-primary bg-bg-card"
            >
              {rightPanel === 'backlinks' && (
                <Backlinks
                  currentNote={currentNote}
                  notes={notes}
                  onSelectNote={setCurrentNote}
                />
              )}
              {rightPanel === 'tags' && (
                <TagCloud
                  notes={notes}
                  selectedTags={selectedTags}
                  onToggleTag={handleToggleTag}
                />
              )}
              {rightPanel === 'graph' && (
                <GraphView
                  notes={notes}
                  currentNote={currentNote}
                  onSelectNote={setCurrentNote}
                />
              )}
            </motion.div>
          </>
        )}
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        notes={notes}
        folders={folders}
        onSelectNote={setCurrentNote}
        onSelectFolder={setSelectedFolderId}
        onCreateNote={() => handleCreateNote()}
      />
    </div>
  );
}
