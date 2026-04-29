import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Folder, Edit3, Trash2 } from 'lucide-react';
import { useFileTreeContext } from '../FileTree';

interface FolderContextMenuProps {
  folderId: string;
  folderName: string;
  onRename: () => void;
  onClose: () => void;
}

export const FolderContextMenu: React.FC<FolderContextMenuProps> = ({
  folderId,
  folderName,
  onRename,
  onClose
}) => {
  const { onCreateNote, onCreateSubFolder, onRequestDelete } = useFileTreeContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuItems = [
    { label: '新建笔记', action: () => onCreateNote(folderId), icon: Plus },
    { label: '新建文件夹', action: () => { onCreateSubFolder(folderId); onClose(); }, icon: Folder },
    { label: '重命名', action: () => { onRename(); onClose(); }, icon: Edit3 },
    { label: '删除', action: () => { onRequestDelete('folder', folderId, folderName); onClose(); }, icon: Trash2, danger: true },
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
