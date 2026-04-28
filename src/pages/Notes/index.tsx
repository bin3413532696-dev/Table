import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Command, PanelLeft, PanelRight, X } from 'lucide-react';
import { FileTree } from './components/FileTree';
import { Editor } from './components/Editor';
import { Backlinks } from './components/Backlinks';
import { TagCloud } from './components/TagCloud';
import { GraphView } from './components/GraphView';
import { CommandPalette } from './components/CommandPalette';
import { noteDB, folderDB, Note, Folder } from '../../db';

type RightPanelType = 'backlinks' | 'tags' | 'graph';
type EditorMode = 'edit' | 'split' | 'preview';

const MIN_LEFT_WIDTH = 200;
const MIN_RIGHT_WIDTH = 200;
const DEFAULT_LEFT_WIDTH = 280;
const DEFAULT_RIGHT_WIDTH = 300;

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanelType>('backlinks');
  const [isVimMode, setIsVimMode] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const leftResizeRef = useRef<HTMLDivElement>(null);
  const rightResizeRef = useRef<HTMLDivElement>(null);
  const isResizingLeft = useRef(false);
  const isResizingRight = useRef(false);

  const loadData = useCallback(async () => {
    const [allNotes, allFolders] = await Promise.all([
      noteDB.getAll(),
      folderDB.getAll()
    ]);
    setNotes(allNotes);
    setFolders(allFolders);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  const handleCreateFolder = useCallback(async (parentId: string | null = null) => {
    const newFolder = await folderDB.add({
      name: '新建文件夹',
      parentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    setFolders(prev => [newFolder, ...prev]);
  }, []);

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    await folderDB.delete(folderId);
    setFolders(prev => prev.filter(f => f.id !== folderId));
    setNotes(prev => prev.map(n => n.folderId === folderId ? { ...n, folderId: null } : n));
  }, []);

  const handleRenameFolder = useCallback(async (folderId: string, newName: string) => {
    await folderDB.update(folderId, { name: newName });
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: newName } : f));
  }, []);

  const handleUpdateNote = useCallback(async (content: string) => {
    if (!currentNote) return;

    const linkRegex = /\[\[([^\]]+)\]\]/g;
    const links: string[] = [];
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      links.push(match[1]);
    }

    await noteDB.update(currentNote.id, { content });
    await noteDB.updateLinks(currentNote.id, links);

    const updatedNotes = await noteDB.getAll();
    setNotes(updatedNotes);
    setCurrentNote(prev => prev ? { ...prev, content, links } : null);
  }, [currentNote]);

  const handleUpdateTitle = useCallback(async (title: string) => {
    if (!currentNote) return;
    await noteDB.update(currentNote.id, { title });
    setNotes(prev => prev.map(n => n.id === currentNote.id ? { ...n, title } : n));
    setCurrentNote(prev => prev ? { ...prev, title } : null);
  }, [currentNote]);

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      const allNotes = await noteDB.getAll();
      setNotes(allNotes);
      return;
    }
    const results = await noteDB.search(searchQuery);
    setNotes(results);
  }, [searchQuery]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    await noteDB.delete(noteId);
    setNotes(prev => prev.filter(n => n.id !== noteId));
    setCurrentNote(prev => prev?.id === noteId ? null : prev);
  }, []);

  const handleMoveNote = useCallback(async (noteId: string, folderId: string | null) => {
    await noteDB.update(noteId, { folderId });
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, folderId } : n));
    setCurrentNote(prev => prev?.id === noteId ? { ...prev, folderId } : prev);
  }, []);

  const filteredNotes = selectedTags.length > 0
    ? notes.filter(n => selectedTags.some(tag => n.tags?.includes(tag)))
    : notes;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft.current) {
        const newWidth = e.clientX;
        if (newWidth >= MIN_LEFT_WIDTH && newWidth <= 400) {
          setLeftWidth(newWidth);
        }
      }
      if (isResizingRight.current) {
        const containerWidth = window.innerWidth;
        const newWidth = containerWidth - e.clientX;
        if (newWidth >= MIN_RIGHT_WIDTH && newWidth <= 500) {
          setRightWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      isResizingLeft.current = false;
      isResizingRight.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startResizeLeft = () => { isResizingLeft.current = true; };
  const startResizeRight = () => { isResizingRight.current = true; };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-200 bg-white/80 backdrop-blur-xl">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLeftCollapsed(!leftCollapsed)}
            className={`p-2 rounded-lg transition-colors ${
              leftCollapsed ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-100 text-gray-500'
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
                className="px-3 py-1.5 text-sm rounded-lg outline-none w-64 bg-gray-100 text-gray-900 placeholder-gray-400"
                autoFocus
              />
              <button
                onClick={handleSearch}
                className="p-2 rounded-lg transition-colors hover:bg-gray-100 text-gray-500"
              >
                <Search className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsSearching(false);
                  setSearchQuery('');
                  loadData();
                }}
                className="p-2 rounded-lg transition-colors hover:bg-gray-100 text-gray-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setIsSearching(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors hover:bg-gray-100 text-gray-500"
              >
                <Search className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsCommandPaletteOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors hover:bg-gray-100 text-gray-500"
              >
                <Command className="w-4 h-4" />
                <span className="text-xs px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-400 border border-gray-200">⌘K</span>
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
              className="px-3 py-1.5 text-sm font-medium rounded-lg outline-none transition-colors bg-transparent text-gray-900 hover:bg-gray-100 focus:bg-gray-100 text-center"
            />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg bg-gray-100 p-0.5">
            {(['backlinks', 'tags', 'graph'] as RightPanelType[]).map((panel, i) => (
              <button
                key={panel}
                onClick={() => {
                  if (rightCollapsed) setRightCollapsed(false);
                  setRightPanel(panel);
                }}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  rightPanel === panel && !rightCollapsed
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
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
              rightCollapsed ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-100 text-gray-500'
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
              className="border-r overflow-hidden border-gray-200 bg-white"
            >
              <FileTree
                folders={folders}
                notes={filteredNotes}
                selectedNoteId={currentNote?.id || null}
                selectedFolderId={selectedFolderId}
                onSelectNote={setCurrentNote}
                onSelectFolder={setSelectedFolderId}
                onCreateFolder={handleCreateFolder}
                onCreateNote={handleCreateNote}
                onDeleteFolder={handleDeleteFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteNote={handleDeleteNote}
                onMoveNote={handleMoveNote}
              />
            </motion.div>
            <div
              ref={leftResizeRef}
              onMouseDown={startResizeLeft}
              className="w-1 cursor-col-resize hover:w-1.5 hover:bg-blue-400 transition-all bg-gray-100 shrink-0"
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
              <div className="w-20 h-20 rounded-2xl mb-5 flex items-center justify-center bg-white shadow-sm border border-gray-200">
                <Search className="w-8 h-8 text-gray-300" />
              </div>
              <p className="text-base font-medium text-gray-700 mb-1">选择一个笔记开始编辑</p>
              <p className="text-sm text-gray-400 mb-6">或者创建一个新笔记</p>
              <button
                onClick={() => handleCreateNote()}
                className="px-5 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-900 hover:bg-gray-800 text-white"
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
              className="w-1 cursor-col-resize hover:w-1.5 hover:bg-blue-400 transition-all bg-gray-100 shrink-0"
            />
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: rightWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-l overflow-hidden border-gray-200 bg-white"
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
