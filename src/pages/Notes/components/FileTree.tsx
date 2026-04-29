import React, { useState, useCallback, useEffect, useRef, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder, FolderOpen, FileText, Plus, MoreVertical, ChevronRight, ChevronDown, Trash2, Edit3, GripVertical } from 'lucide-react';
import { noteDB, folderDB, Folder as FolderType, Note } from '../../../db';

interface FileTreeContextValue {
  notes: Note[];
  folders: FolderType[];
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (id: string) => void;
  onSelectNote: (note: Note) => void;
  onSelectFolder: (id: string | null) => void;
  onCreateNote: (folderId: string | null) => void;
  onDeleteNote: (noteId: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
  onCreateSubFolder: (parentId: string | null) => void;
  onDeleteFolder: (folderId: string) => void;
}

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

function useFileTreeContext(): FileTreeContextValue {
  const ctx = useContext(FileTreeContext);
  if (!ctx) throw new Error('FileTreeContext not found');
  return ctx;
}

interface FileTreeProps {
  notes: Note[];
  folders: FolderType[];
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  onSelectNote: (note: Note) => void;
  onSelectFolder: (folderId: string | null) => void;
  onCreateNote: (folderId: string | null) => void;
  onDeleteNote: (noteId: string) => void;
  onNotesChanged: (notes: Note[]) => void;
  onFoldersChanged: (folders: FolderType[]) => void;
}

const GUIDE_LINE_OFFSET = 10;

const NoteContextMenu: React.FC<{
  noteId: string;
  onClose: () => void;
}> = ({ noteId, onClose }) => {
  const { onDeleteNote } = useFileTreeContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(0);
          break;
        case 'Enter':
          e.preventDefault();
          onDeleteNote(noteId);
          onClose();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [noteId, onDeleteNote, onClose]);

  useEffect(() => {
    const firstButton = menuRef.current?.querySelector('button');
    firstButton?.focus();
  }, []);

  return (
    <motion.div
      ref={menuRef}
      role="menu"
      aria-label="笔记操作菜单"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute right-0 top-full mt-1 py-1 rounded-lg shadow-xl z-50 min-w-[120px] bg-bg-card border border-border-secondary ring-1 ring-black/5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <button
        role="menuitem"
        onClick={() => {
          onDeleteNote(noteId);
          onClose();
        }}
        className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${
          selectedIndex === 0 ? 'bg-rose-50 dark:bg-rose-900/30' : 'hover:bg-rose-50 dark:hover:bg-rose-900/20'
        } text-rose-600 dark:text-rose-400`}
        tabIndex={selectedIndex === 0 ? 0 : -1}
      >
        <Trash2 className="w-3.5 h-3.5" />
        删除笔记
      </button>
    </motion.div>
  );
};

const FolderContextMenu: React.FC<{
  folderId: string;
  onRename: () => void;
  onClose: () => void;
}> = ({ folderId, onRename, onClose }) => {
  const { onCreateNote, onCreateSubFolder, onDeleteFolder } = useFileTreeContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuItems = [
    { label: '新建笔记', action: () => onCreateNote(folderId), icon: Plus },
    { label: '新建文件夹', action: () => { onCreateSubFolder(folderId); onClose(); }, icon: Folder },
    { label: '重命名', action: () => { onRename(); onClose(); }, icon: Edit3 },
    { label: '删除', action: () => { onDeleteFolder(folderId); onClose(); }, icon: Trash2, danger: true },
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => (prev + 1) % menuItems.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => (prev - 1 + menuItems.length) % menuItems.length);
          break;
        case 'Enter':
          e.preventDefault();
          menuItems[selectedIndex].action();
          onClose();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuItems, selectedIndex, onClose]);

  useEffect(() => {
    const firstButton = menuRef.current?.querySelector('button');
    firstButton?.focus();
  }, []);

  return (
    <motion.div
      ref={menuRef}
      role="menu"
      aria-label="文件夹操作菜单"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute right-0 top-full mt-1 py-1 rounded-lg shadow-lg z-50 min-w-[140px] bg-bg-card border border-border-primary"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {menuItems.map((item, index) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            item.action();
            onClose();
          }}
          className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${
            selectedIndex === index
              ? item.danger
                ? 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                : 'bg-bg-tertiary text-text-secondary'
              : item.danger
              ? 'hover:bg-rose-50 text-rose-600 dark:hover:bg-rose-900/20 dark:text-rose-400'
              : 'hover:bg-bg-tertiary text-text-secondary'
          }`}
          tabIndex={selectedIndex === index ? 0 : -1}
        >
          <item.icon className="w-3.5 h-3.5" />
          {item.label}
        </button>
      ))}
    </motion.div>
  );
};

const NoteItem: React.FC<{
  note: Note;
  level: number;
}> = ({ note, level }) => {
  const { selectedNoteId, onSelectNote, onDeleteNote } = useFileTreeContext();
  const [showMenu, setShowMenu] = useState(false);
  const isSelected = selectedNoteId === note.id;

  return (
    <div className="relative group">
      {level > 0 && (
        <div
          className="absolute top-1/2 w-3 h-px bg-border-primary pointer-events-none"
          style={{ left: `${level * 16 + GUIDE_LINE_OFFSET}px` }}
        />
      )}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', note.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={() => onSelectNote(note)}
        className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer transition-colors ${
          isSelected
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
            : 'hover:bg-bg-secondary text-text-secondary'
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        <GripVertical className="w-3 h-3 opacity-0 group-hover:opacity-40 text-text-muted flex-shrink-0" />
        <FileText className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-sm truncate flex-1">{note.title}</span>

        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-bg-tertiary"
            aria-label="笔记操作菜单"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>

          <AnimatePresence>
            {showMenu && (
              <NoteContextMenu
                noteId={note.id}
                onClose={() => setShowMenu(false)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const TreeNode: React.FC<{
  folder: FolderType;
  level: number;
}> = ({ folder, level }) => {
  const {
    notes, folders, selectedNoteId, selectedFolderId,
    expandedFolders, onToggleFolder, onSelectNote, onSelectFolder,
    onCreateNote, onRenameFolder, onMoveNote
  } = useFileTreeContext();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [showMenu, setShowMenu] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const isExpanded = expandedFolders.has(folder.id);
  const childFolders = folders.filter(f => f.parentId === folder.id);
  const folderNotes = notes.filter(n => n.folderId === folder.id);
  const isSelected = selectedFolderId === folder.id;
  const isParent = level === 0;

  const handleRename = () => {
    if (renameValue.trim() && renameValue !== folder.name) {
      onRenameFolder(folder.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const noteId = e.dataTransfer.getData('text/plain');
    if (noteId) {
      onMoveNote(noteId, folder.id);
    }
  };

  const hasChildren = childFolders.length > 0 || folderNotes.length > 0;

  return (
    <div>
      <div className="relative group">
        {level > 0 && (
          <div
            className="absolute top-1/2 w-3 h-px bg-border-primary pointer-events-none"
            style={{ left: `${level * 16 + GUIDE_LINE_OFFSET}px` }}
          />
        )}
        <div
          className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer transition-colors ${
            isSelected
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
              : dragOver
                ? 'bg-blue-50 text-blue-700 ring-2 ring-blue-400 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-600'
                : 'hover:bg-bg-secondary text-text-secondary'
          }`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isSelected && (
            <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-blue-500" />
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFolder(folder.id);
            }}
            className={`p-0.5 rounded transition-colors ${
              isSelected
                ? 'hover:bg-blue-500 text-white'
                : 'hover:bg-bg-tertiary text-text-muted'
            }`}
            aria-label={isExpanded ? '折叠文件夹' : '展开文件夹'}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" strokeWidth={2.5} />
            ) : (
              <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
            )}
          </button>

          {isExpanded ? (
            <FolderOpen
              className={`w-4 h-4 flex-shrink-0 ${
                isSelected ? 'text-blue-600 dark:text-blue-300' : 'text-blue-400 dark:text-blue-300'
              }`}
            />
          ) : (
            <Folder
              className={`w-4 h-4 flex-shrink-0 ${
                isSelected
                  ? 'text-white'
                  : isParent
                    ? 'text-blue-600 dark:text-blue-300'
                    : 'text-blue-400 dark:text-blue-300'
              }`}
            />
          )}

          {isRenaming ? (
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') {
                  setRenameValue(folder.name);
                  setIsRenaming(false);
                }
              }}
              className="flex-1 px-1 py-0.5 text-sm rounded border bg-bg-card border-border-secondary text-text-primary"
              autoFocus
            />
          ) : (
            <span
              onClick={() => onSelectFolder(folder.id)}
              className={`flex-1 text-sm truncate ${
                isSelected ? 'font-semibold text-white' : 'text-text-secondary'
              }`}
            >
              {folder.name}
            </span>
          )}

          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                isSelected
                  ? 'text-blue-400 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/20'
                  : 'hover:bg-bg-tertiary text-text-muted'
              }`}
              aria-label="文件夹操作菜单"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            <AnimatePresence>
              {showMenu && (
                <FolderContextMenu
                  folderId={folder.id}
                  onRename={() => setIsRenaming(true)}
                  onClose={() => setShowMenu(false)}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative"
          >
            <div
              className="absolute top-0 bottom-0 w-px bg-border-primary pointer-events-none"
              style={{ left: `${(level + 1) * 16 + GUIDE_LINE_OFFSET}px` }}
            />
            {childFolders.map(childFolder => (
              <TreeNode
                key={childFolder.id}
                folder={childFolder}
                level={level + 1}
              />
            ))}

            {folderNotes.map(note => (
              <NoteItem
                key={note.id}
                note={note}
                level={level + 1}
              />
            ))}
          </motion.div>
        )}
        {isExpanded && !hasChildren && level > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative"
          >
            <div
              className="absolute top-0 h-4 w-px bg-border-primary pointer-events-none"
              style={{ left: `${(level + 1) * 16 + GUIDE_LINE_OFFSET}px` }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({
  notes,
  folders,
  selectedNoteId,
  selectedFolderId,
  onSelectNote,
  onSelectFolder,
  onCreateNote,
  onDeleteNote,
  onNotesChanged,
  onFoldersChanged,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [dragOverRoot, setDragOverRoot] = useState(false);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleCreateFolder = useCallback(async (parentId: string | null) => {
    await folderDB.add({
      name: '新建文件夹',
      parentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      noteCount: 0
    });
    onFoldersChanged(await folderDB.getAll());
  }, [onFoldersChanged]);

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    await folderDB.delete(folderId);
    const [allFolders, allNotes] = await Promise.all([folderDB.getAll(), noteDB.getAll()]);
    onFoldersChanged(allFolders);
    onNotesChanged(allNotes);
  }, [onFoldersChanged, onNotesChanged]);

  const handleRenameFolder = useCallback(async (folderId: string, newName: string) => {
    await folderDB.update(folderId, { name: newName });
    const allFolders = await folderDB.getAll();
    onFoldersChanged(allFolders);
  }, [onFoldersChanged]);

  const handleMoveNote = useCallback(async (noteId: string, targetFolderId: string | null) => {
    await noteDB.update(noteId, { folderId: targetFolderId });
    const allNotes = await noteDB.getAll();
    onNotesChanged(allNotes);
  }, [onNotesChanged]);

  const rootFolders = folders.filter(f => f.parentId === null);
  const rootNotes = notes.filter(n => n.folderId === null);

  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverRoot(true);
  };

  const handleRootDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverRoot(false);
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverRoot(false);
    const noteId = e.dataTransfer.getData('text/plain');
    if (noteId) {
      handleMoveNote(noteId, null);
    }
  };

  const handleRootCreateNote = useCallback(() => onCreateNote(null), [onCreateNote]);
  const handleRootCreateFolder = useCallback(() => handleCreateFolder(null), [handleCreateFolder]);

  const contextValue: FileTreeContextValue = {
    notes, folders, selectedNoteId, selectedFolderId,
    expandedFolders, onToggleFolder: toggleFolder,
    onSelectNote, onSelectFolder,
    onCreateNote, onDeleteNote,
    onRenameFolder: handleRenameFolder,
    onMoveNote: handleMoveNote,
    onCreateSubFolder: handleCreateFolder,
    onDeleteFolder: handleDeleteFolder,
  };

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div className="h-full overflow-y-auto">
        <div className="p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              文件
            </h3>
            <div className="flex gap-1">
              <button
                onClick={handleRootCreateNote}
                className="p-1.5 rounded-lg transition-colors hover:bg-bg-tertiary text-text-muted"
                title="新建笔记"
                aria-label="新建笔记"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={handleRootCreateFolder}
                className="p-1.5 rounded transition-colors hover:bg-bg-tertiary text-text-muted"
                title="新建文件夹"
                aria-label="新建文件夹"
              >
                <Folder className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            onClick={() => onSelectFolder(null)}
            onDragOver={handleRootDragOver}
            onDragLeave={handleRootDragLeave}
            onDrop={handleRootDrop}
            className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded transition-colors mb-1 ${
              selectedFolderId === null && !selectedNoteId
                ? 'bg-blue-50 text-blue-700 font-medium'
                : dragOverRoot
                  ? 'bg-blue-50 text-blue-700 ring-2 ring-blue-400 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-600'
                  : 'hover:bg-bg-secondary text-text-secondary'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span className="text-sm">全部笔记</span>
            <span className={`text-xs ${selectedFolderId === null && !selectedNoteId ? 'text-blue-400 dark:text-blue-300' : 'text-text-muted'}`}>({notes.length})</span>
          </div>

          {rootFolders.map(folder => (
            <TreeNode
              key={folder.id}
              folder={folder}
              level={0}
            />
          ))}

          {rootNotes.map(note => (
            <NoteItem
              key={note.id}
              note={note}
              level={0}
            />
          ))}
        </div>
      </div>
    </FileTreeContext.Provider>
  );
};
