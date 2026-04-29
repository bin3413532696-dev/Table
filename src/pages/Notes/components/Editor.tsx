import React, { useCallback, useState, useRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { vim } from '@replit/codemirror-vim';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bold, Italic, Strikethrough, Heading, List, ListOrdered, Quote, Code, Link, CheckSquare, Maximize2, Minimize2 } from 'lucide-react';

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  isVimMode: boolean;
  onToggleVim: () => void;
}

export const Editor: React.FC<EditorProps> = ({
  content,
  onChange,
  isVimMode,
  onToggleVim
}) => {
  const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('edit');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const insertText = useCallback((before: string, after: string = '') => {
    const view = editorRef.current?.view;
    if (!view) return;

    const selection = view.state.selection.main;
    const from = selection.from;
    const to = selection.to;
    const selectedText = view.state.doc.sliceString(from, to);
    const newText = before + selectedText + after;

    let cursorPos = from + before.length + selectedText.length;

    const urlIndex = after.indexOf('url');
    if (urlIndex !== -1) {
      cursorPos = from + before.length + selectedText.length + urlIndex;
    }

    view.dispatch({
      changes: {
        from,
        to,
        insert: newText
      },
      selection: {
        anchor: cursorPos,
        head: cursorPos
      }
    });
  }, []);

  const extensions: Extension[] = [markdown()];
  if (isVimMode) {
    extensions.push(vim());
  }

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-50' : ''} bg-bg-primary`}>

      <div className="flex items-center justify-between px-3 py-2 border-b border-border-primary bg-bg-primary/80 backdrop-blur-xl">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => insertText('**', '**')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="粗体"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('*', '*')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="斜体"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('~~', '~~')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="删除线"
          >
            <Strikethrough className="w-4 h-4" />
          </button>
          <div className="w-px h-5 mx-1 bg-border-primary" />
          <button
            onClick={() => insertText('## ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="标题"
          >
            <Heading className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('- ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="无序列表"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('1. ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="有序列表"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('> ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="引用"
          >
            <Quote className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('```\n', '\n```')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="代码块"
          >
            <Code className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('[', '](url)')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="链接"
          >
            <Link className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('- [ ] ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="任务列表"
          >
            <CheckSquare className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-bg-tertiary p-0.5">
            <button
              onClick={() => setMode('edit')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                mode === 'edit'
                  ? 'bg-bg-card text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              编辑
            </button>
            <button
              onClick={() => setMode('split')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                mode === 'split'
                  ? 'bg-bg-card text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              分屏
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                mode === 'preview'
                  ? 'bg-bg-card text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              预览
            </button>
          </div>

          <button
            onClick={onToggleVim}
            className={`px-2 py-1.5 text-sm rounded-md transition-colors ${
              isVimMode
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            Vim
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {mode === 'edit' && (
          <CodeMirror
            ref={editorRef}
            value={content}
            height="100%"
            theme="light"
            extensions={extensions}
            onChange={onChange}
            className="h-full"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: false,
            }}
          />
        )}

        {mode === 'split' && (
          <div className="flex h-full">
            <div className="w-1/2 border-r border-border-primary">
              <CodeMirror
                ref={editorRef}
                value={content}
                height="100%"
                theme="light"
                extensions={extensions}
                onChange={onChange}
                className="h-full"
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLineGutter: true,
                  highlightActiveLine: true,
                }}
              />
            </div>
            <div className="w-1/2 overflow-y-auto p-4 text-text-primary bg-bg-primary">
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {mode === 'preview' && (
          <div className="h-full overflow-y-auto p-4 text-text-primary bg-bg-primary">
            <div className="markdown-body max-w-3xl mx-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
