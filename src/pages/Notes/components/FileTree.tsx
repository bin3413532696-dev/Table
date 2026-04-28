import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder, FolderOpen, FileText, Plus, MoreVertical, ChevronRight, ChevronDown, Trash2, Edit3 } from 'lucide-react';
import { Folder as FolderType, Note } from '../../../db';

interface FileTreeProps {
  folders: FolderType[];
  notes: Note[];
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  onSelectNote: (note: Note) => void;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onCreateNote: (folderId: string | null) => void;
  onDeleteFolder: (folderId: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
}

interface TreeNodeProps {
  folder: FolderType;
  folders: FolderType[];
  notes: Note[];
  level: number;
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (folderId: string) => void;
  onSelectNote: (note: Note) => void;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onCreateNote: (folderId: string | null) => void;
  onDeleteFolder: (folderId: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  folder,
  folders,
  notes,
  level,
  selectedNoteId,
  selectedFolderId,
  expandedFolders,
  onToggleFolder,
  onSelectNote,
  onSelectFolder,
  onCreateFolder,
  onCreateNote,
  onDeleteFolder,
  onRenameFolder
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [showMenu, setShowMenu] = useState(false);
  const isExpanded = expandedFolders.has(folder.id);
  const childFolders = folders.filter(f => f.parentId === folder.id);
  const folderNotes = notes.filter(n => n.folderId === folder.id);
  const isSelected = selectedFolderId === folder.id;

  const handleRename = () => {
    if (renameValue.trim() && renameValue !== folder.name) {
      onRenameFolder(folder.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer transition-colors ${
          isSelected
            ? 'bg-blue-100 text-blue-700'
            : 'hover:bg-gray-100 text-gray-700'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFolder(folder.id);
          }}
          className="p-0.5 rounded transition-colors hover:bg-gray-200"
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>

        {isExpanded ? (
          <FolderOpen className="w-4 h-4 text-blue-600" />
        ) : (
          <Folder className="w-4 h-4 text-blue-600" />
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
            className="flex-1 px-1 py-0.5 text-sm rounded border bg-white border-gray-300"
            autoFocus
          />
        ) : (
          <span
            onClick={() => onSelectFolder(folder.id)}
            className="flex-1 text-sm truncate"
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
            className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>

          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-full mt-1 py-1 rounded-lg shadow-lg z-50 min-w-[120px] bg-white border border-gray-200"
              >
                <button
                  onClick={() => {
                    onCreateNote(folder.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-gray-100 text-gray-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新建笔记
                </button>
                <button
                  onClick={() => {
                    onCreateFolder(folder.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-gray-100 text-gray-700"
                >
                  <Folder className="w-3.5 h-3.5" />
                  新建文件夹
                </button>
                <button
                  onClick={() => {
                    setIsRenaming(true);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-gray-100 text-gray-700"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  重命名
                </button>
                <button
                  onClick={() => {
                    onDeleteFolder(folder.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-rose-50 text-rose-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {childFolders.map(childFolder => (
              <TreeNode
                key={childFolder.id}
                folder={childFolder}
                folders={folders}
                notes={notes}
                level={level + 1}
                selectedNoteId={selectedNoteId}
                selectedFolderId={selectedFolderId}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onSelectNote={onSelectNote}
                onSelectFolder={onSelectFolder}
                onCreateFolder={onCreateFolder}
                onCreateNote={onCreateNote}
                onDeleteFolder={onDeleteFolder}
                onRenameFolder={onRenameFolder}
              />
            ))}

            {folderNotes.map(note => (
              <div
                key={note.id}
                onClick={() => onSelectNote(note)}
                className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
                  selectedNoteId === note.id
                    ? 'bg-blue-50 text-blue-700'
                    : 'hover:bg-gray-100 text-gray-600'
                }`}
                style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}
              >
                <FileText className="w-3.5 h-3.5" />
                <span className="text-sm truncate flex-1">{note.title}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({
  folders,
  notes,
  selectedNoteId,
  selectedFolderId,
  onSelectNote,
  onSelectFolder,
  onCreateFolder,
  onCreateNote,
  onDeleteFolder,
  onRenameFolder
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

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

  const rootFolders = folders.filter(f => f.parentId === null);
  const rootNotes = notes.filter(n => n.folderId === null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            文件
          </h3>
          <div className="flex gap-1">
            <button
              onClick={() => onCreateNote(null)}
              className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-500"
              title="新建笔记"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => onCreateFolder(null)}
              className="p-1.5 rounded transition-colors hover:bg-gray-100 text-gray-500"
              title="新建文件夹"
            >
              <Folder className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div
          onClick={() => onSelectFolder(null)}
          className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded transition-colors mb-1 ${
            selectedFolderId === null && !selectedNoteId
              ? 'bg-blue-100 text-blue-700'
              : 'hover:bg-gray-100 text-gray-700'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span className="text-sm">全部笔记</span>
          <span className="text-xs text-gray-400">({notes.length})</span>
        </div>

        {rootFolders.map(folder => (
          <TreeNode
            key={folder.id}
            folder={folder}
            folders={folders}
            notes={notes}
            level={0}
            selectedNoteId={selectedNoteId}
            selectedFolderId={selectedFolderId}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onSelectNote={onSelectNote}
            onSelectFolder={onSelectFolder}
            onCreateFolder={onCreateFolder}
            onCreateNote={onCreateNote}
            onDeleteFolder={onDeleteFolder}
            onRenameFolder={onRenameFolder}
          />
        ))}

        {rootNotes.map(note => (
          <div
            key={note.id}
            onClick={() => onSelectNote(note)}
            className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
              selectedNoteId === note.id
                ? 'bg-blue-50 text-blue-700'
                : 'hover:bg-gray-100 text-gray-600'
            }`}
            style={{ paddingLeft: '8px' }}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="text-sm truncate flex-1">{note.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
