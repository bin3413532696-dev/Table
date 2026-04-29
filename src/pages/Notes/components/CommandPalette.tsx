import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileText, Folder, Command, X } from 'lucide-react';
import Fuse from 'fuse.js';
import { Note, Folder as FolderType } from '../../../db';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  notes: Note[];
  folders: FolderType[];
  onSelectNote: (note: Note) => void;
  onSelectFolder: (folderId: string | null) => void;
  onCreateNote: () => void;
}

type CommandItem = {
  id: string;
  type: 'note' | 'folder' | 'action';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  notes,
  folders,
  onSelectNote,
  onSelectFolder,
  onCreateNote
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    items.push({
      id: 'new-note',
      type: 'action',
      title: '新建笔记',
      subtitle: '创建一个新的笔记',
      icon: <FileText className="w-4 h-4" />,
      action: () => {
        onCreateNote();
        onClose();
      }
    });

    notes.forEach(note => {
      items.push({
        id: `note-${note.id}`,
        type: 'note',
        title: note.title,
        subtitle: note.content.slice(0, 50) + '...',
        icon: <FileText className="w-4 h-4" />,
        action: () => {
          onSelectNote(note);
          onClose();
        }
      });
    });

    folders.forEach(folder => {
      items.push({
        id: `folder-${folder.id}`,
        type: 'folder',
        title: folder.name,
        subtitle: '文件夹',
        icon: <Folder className="w-4 h-4" />,
        action: () => {
          onSelectFolder(folder.id);
          onClose();
        }
      });
    });

    return items;
  }, [notes, folders, onSelectNote, onSelectFolder, onCreateNote, onClose]);

  const commandFuse = useMemo(() => new Fuse(commands, {
    keys: [
      { name: 'title', weight: 2 },
      { name: 'subtitle', weight: 1 }
    ],
    threshold: 0.4,
    includeScore: true,
    minMatchCharLength: 1
  }), [commands]);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    return commandFuse.search(query).map(r => r.item);
  }, [commands, query, commandFuse]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => (prev + 1) % filteredCommands.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Tab':
          e.preventDefault();
          if (!modalRef.current) return;
          const focusableElements = modalRef.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusableElements.length === 0) return;
          
          const firstElement = focusableElements[0] as HTMLElement;
          const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
          
          if (e.shiftKey) {
            if (document.activeElement === firstElement) {
              lastElement.focus();
            }
          } else {
            if (document.activeElement === lastElement) {
              firstElement.focus();
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />
          <motion.div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 w-full max-w-2xl z-50 rounded-xl shadow-2xl overflow-hidden bg-bg-card border border-border-primary"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-primary">
              <Search className="w-5 h-5 text-text-muted" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索笔记、文件夹或输入命令..."
                className="flex-1 outline-none text-base text-text-primary placeholder-text-muted"
                autoFocus
              />
              <div className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-bg-tertiary text-text-secondary">
                <Command className="w-3 h-3" />
                <span>K</span>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded transition-colors hover:bg-bg-tertiary text-text-muted"
                aria-label="关闭命令面板"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {filteredCommands.length > 0 ? (
                <div className="py-2">
                  {filteredCommands.map((cmd, index) => (
                    <button
                      key={cmd.id}
                      onClick={cmd.action}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                        index === selectedIndex ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                      }`}
                    >
                      <div className="p-1.5 rounded bg-bg-tertiary text-text-secondary">
                        {cmd.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-text-primary">
                          {cmd.title}
                        </div>
                        {cmd.subtitle && (
                          <div className="text-sm truncate text-text-muted">
                            {cmd.subtitle}
                          </div>
                        )}
                      </div>
                      {cmd.type === 'action' && (
                        <span className="text-xs px-2 py-0.5 rounded bg-primary-100 text-primary dark:bg-primary-900/20">
                          动作
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-text-muted">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>未找到匹配的结果</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-2 text-xs border-t border-border-primary text-text-muted">
              <div className="flex items-center gap-4">
                <span>↑↓ 选择</span>
                <span>↵ 确认</span>
                <span>Esc 关闭</span>
              </div>
              <span>{filteredCommands.length} 个结果</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
