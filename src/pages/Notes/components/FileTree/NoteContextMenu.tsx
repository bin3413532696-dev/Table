import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { useFileTreeContext } from '../FileTree';

interface NoteContextMenuProps {
  noteId: string;
  noteTitle: string;
  onClose: () => void;
}

export const NoteContextMenu: React.FC<NoteContextMenuProps> = ({
  noteId,
  noteTitle,
  onClose
}) => {
  const { onRequestDelete } = useFileTreeContext();
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
          onRequestDelete('note', noteId, noteTitle);
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
  }, [noteId, noteTitle, onRequestDelete, onClose]);

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
          onRequestDelete('note', noteId, noteTitle);
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
