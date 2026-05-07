import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  CheckSquare,
  Link2,
  Code,
  Quote,
  Heading1,
  Heading2,
} from 'lucide-react';

interface NoteEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
}

const toolbarButtonClass = (active: boolean) =>
  `p-1.5 rounded transition-colors ${
    active
      ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400'
      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
  }`;

export function NoteEditor({ content, onChange, placeholder = '开始编写笔记...' }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 dark:text-blue-400 underline',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[200px] p-3',
      },
    },
  });

  if (!editor) {
    return null;
  }

  const addLink = () => {
    const url = window.prompt('输入链接地址');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      <div className="flex items-center gap-1 p-2 border-b bg-gray-50 dark:bg-gray-800 flex-wrap">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={toolbarButtonClass(editor.isActive('bold'))}
          title="粗体"
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={toolbarButtonClass(editor.isActive('italic'))}
          title="斜体"
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={toolbarButtonClass(editor.isActive('heading', { level: 1 }))}
          title="标题 1"
        >
          <Heading1 size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={toolbarButtonClass(editor.isActive('heading', { level: 2 }))}
          title="标题 2"
        >
          <Heading2 size={16} />
        </button>
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={toolbarButtonClass(editor.isActive('bulletList'))}
          title="无序列表"
        >
          <List size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={toolbarButtonClass(editor.isActive('orderedList'))}
          title="有序列表"
        >
          <ListOrdered size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={toolbarButtonClass(editor.isActive('taskList'))}
          title="任务列表"
        >
          <CheckSquare size={16} />
        </button>
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={toolbarButtonClass(editor.isActive('code'))}
          title="代码"
        >
          <Code size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={toolbarButtonClass(editor.isActive('blockquote'))}
          title="引用"
        >
          <Quote size={16} />
        </button>
        <button
          type="button"
          onClick={addLink}
          className={toolbarButtonClass(editor.isActive('link'))}
          title="链接"
        >
          <Link2 size={16} />
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}