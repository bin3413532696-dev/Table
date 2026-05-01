import React, { useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { WikiLink } from './extensions/WikiLink';

export interface Note {
  id: string;
  title: string;
}

export interface PKMEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  notes: Note[];
  onWikiLinkClick?: (id: string, name: string) => void;
}

const PKMEditor: React.FC<PKMEditorProps> = ({ content, onChange, notes, onWikiLinkClick }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary hover:underline',
        },
      }),
      Image.configure({
        inline: false,
        HTMLAttributes: {
          class: 'rounded-lg max-w-full',
        },
      }),
      Placeholder.configure({
        placeholder: '开始输入... 支持 Markdown 格式',
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      WikiLink,
    ],
    content,
    contentType: 'markdown',
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getMarkdown());
    },
  });

  const handleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.dataset.type === 'wiki-link' && target.dataset.id) {
      onWikiLinkClick?.(target.dataset.id, target.dataset.name || '');
    }
  }, [onWikiLinkClick]);

  if (!editor) {
    return null;
  }

  return (
    <div className="pkm-editor h-full" onClick={handleClick}>
      <EditorContent editor={editor} className="h-full" />
    </div>
  );
};

export default PKMEditor;