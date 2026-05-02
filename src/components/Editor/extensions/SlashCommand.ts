import { Editor } from '@tiptap/react';

export interface CommandItem {
  id: string;
  title: string;
  command: (editor: Editor) => void;
}

export const SLASH_COMMANDS: CommandItem[] = [
  {
    id: 'h1',
    title: '标题 1',
    command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    title: '标题 2',
    command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    title: '标题 3',
    command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'table',
    title: '表格',
    command: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'image',
    title: '图片',
    command: (editor) => {
      const url = window.prompt('输入图片 URL');
      if (url) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    },
  },
  {
    id: 'codeBlock',
    title: '代码块',
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'blockquote',
    title: '引用',
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'horizontalRule',
    title: '分割线',
    command: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'taskList',
    title: '任务列表',
    command: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'callout',
    title: '提示框',
    command: (editor) =>
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'paragraph',
          marks: [{ type: 'bold' }],
        })
        .insertContent(' ')
        .run(),
  },
];

export function filterCommands(query: string): CommandItem[] {
  if (!query) return SLASH_COMMANDS;
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.title.toLowerCase().includes(q));
}