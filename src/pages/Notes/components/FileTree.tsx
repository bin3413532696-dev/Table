import React, { useState, useCallback, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder, FileText, Plus, AlertTriangle } from 'lucide-react';
import { noteDB, folderDB, Folder as FolderType, Note } from '../../../db';
import { TreeNode } from './FileTree/TreeNode';
import { NoteItem } from './FileTree/NoteItem';

interface DeleteConfirmState {
  type: 'note' | 'folder';
  id: string;
  name: string;
}

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
  onRequestDelete: (type: 'note' | 'folder', id: string, name: string) => void;
}

const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export function useFileTreeContext(): FileTreeContextValue {
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
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);

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

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'note') {
      onDeleteNote(deleteConfirm.id);
    } else {
      await handleDeleteFolder(deleteConfirm.id);
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, onDeleteNote, handleDeleteFolder]);

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
    onRequestDelete: (type, id, name) => setDeleteConfirm({ type, id, name }),
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
                ? 'bg-primary-50 text-primary font-medium'
                : dragOverRoot
                  ? 'bg-primary-50 text-primary ring-2 ring-primary dark:bg-primary-900/20'
                  : 'hover:bg-bg-secondary text-text-secondary'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span className="text-sm">全部笔记</span>
            <span className={`text-xs ${selectedFolderId === null && !selectedNoteId ? 'text-primary-400 dark:text-primary-300' : 'text-text-muted'}`}>({notes.length})</span>
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

      {/* 删除确认对话框 */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-lg p-6 w-full max-w-sm bg-bg-card shadow-lg border border-border-primary"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-error" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary">确认删除</h3>
              </div>
              <p className="text-text-secondary mb-5 text-sm">
                确定要删除{deleteConfirm.type === 'note' ? '笔记' : '文件夹'}"{deleteConfirm.name}"吗？
                {deleteConfirm.type === 'folder' && ' 其下的所有笔记将移至根目录。此操作无法撤销。'}
                {!deleteConfirm.name && '此操作无法撤销。'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border-primary text-text-secondary hover:bg-bg-secondary transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-error text-white hover:bg-error/90 transition-colors"
                >
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </FileTreeContext.Provider>
  );
};
