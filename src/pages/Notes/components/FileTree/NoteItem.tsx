import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, MoreVertical, GripVertical } from 'lucide-react';
import { useFileTreeContext } from '../FileTree';
import { Note } from '../../../db';
import { NoteContextMenu } from './NoteContextMenu';

interface NoteItemProps {
  note: Note;
  level: number;
}

const GUIDE_LINE_OFFSET = 10;

export const NoteItem: React.FC<NoteItemProps> = ({ note, level }) => {
  const { selectedNoteId, onSelectNote } = useFileTreeContext();
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
            ? 'bg-primary-50 text-primary dark:bg-primary-900/20'
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
                noteTitle={note.title}
                onClose={() => setShowMenu(false)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};