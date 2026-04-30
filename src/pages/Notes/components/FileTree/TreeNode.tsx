import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder, FolderOpen, ChevronRight, ChevronDown, MoreVertical, Edit3 } from 'lucide-react';
import { Folder as FolderType, Note } from '../../../../db';
import { useFileTreeContext } from '../FileTree';
import { FolderContextMenu } from './FolderContextMenu';
import { NoteItem } from './NoteItem';

interface TreeNodeProps {
  folder: FolderType;
  level: number;
}

const GUIDE_LINE_OFFSET = 10;

export const TreeNode: React.FC<TreeNodeProps> = ({ folder, level }) => {
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
              ? 'bg-primary-50 text-primary dark:bg-primary-900/20'
              : dragOver
                ? 'bg-primary-50 text-primary ring-2 ring-primary dark:bg-primary-900/20'
                : 'hover:bg-bg-secondary text-text-secondary'
          }`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isSelected && (
            <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFolder(folder.id);
            }}
            className={`p-0.5 rounded transition-colors ${
              isSelected
                ? 'hover:bg-primary-100 dark:hover:bg-primary-900/20 text-primary'
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
                isSelected ? 'text-primary' : 'text-primary-400 dark:text-primary-300'
              }`}
            />
          ) : (
            <Folder
              className={`w-4 h-4 flex-shrink-0 ${
                isSelected
                  ? 'text-primary'
                  : isParent
                    ? 'text-primary'
                    : 'text-primary-400 dark:text-primary-300'
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
                isSelected ? 'font-semibold text-primary' : 'text-text-secondary'
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
                  ? 'text-primary-400 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-primary-900/20'
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
                  folderName={folder.name}
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