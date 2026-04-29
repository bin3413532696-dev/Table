import React, { useCallback, useState, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
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

const markdownStyles = `
.markdown-body h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 1rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; color: #111827; }
.markdown-body h2 { font-size: 1.5rem; font-weight: 600; margin: 1.25rem 0 0.75rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25rem; color: #111827; }
.markdown-body h3 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; color: #111827; }
.markdown-body h4 { font-size: 1.125rem; font-weight: 600; margin: 0.75rem 0 0.5rem; color: #111827; }
.markdown-body p { margin: 0.75rem 0; line-height: 1.7; color: #374151; }
.markdown-body ul, .markdown-body ol { margin: 0.75rem 0; padding-left: 1.5rem; }
.markdown-body li { margin: 0.25rem 0; color: #374151; }
.markdown-body code { padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.875rem; font-family: ui-monospace, monospace; background-color: #f3f4f6; color: #1f2937; }
.markdown-body pre { padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 1rem 0; background-color: #1f2937; }
.markdown-body pre code { padding: 0; background: transparent; color: #f3f4f6; }
.markdown-body blockquote { padding-left: 1rem; border-left: 4px solid #e5e7eb; margin: 1rem 0; font-style: italic; color: #6b7280; }
.markdown-body table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
.markdown-body th, .markdown-body td { padding: 0.5rem; border: 1px solid #e5e7eb; text-align: left; }
.markdown-body th { font-weight: 600; background-color: #f9fafb; }
.markdown-body a { text-decoration: underline; color: #2563eb; }
.markdown-body img { max-width: 100%; border-radius: 0.5rem; }
.markdown-body hr { margin: 1.5rem 0; border: none; border-top: 2px solid #e5e7eb; }
.markdown-body input[type="checkbox"] { margin-right: 0.5rem; }

.dark .markdown-body h1,
.dark .markdown-body h2,
.dark .markdown-body h3,
.dark .markdown-body h4 { color: #f1f5f9; border-bottom-color: #334155; }
.dark .markdown-body p,
.dark .markdown-body li { color: #cbd5e1; }
.dark .markdown-body code { background-color: #334155; color: #f1f5f9; }
.dark .markdown-body pre { background-color: #0f172a; }
.dark .markdown-body pre code { color: #e2e8f0; }
.dark .markdown-body blockquote { color: #94a3b8; border-left-color: #475569; }
.dark .markdown-body th,
.dark .markdown-body td { border-color: #334155; }
.dark .markdown-body th { background-color: #1e293b; }
.dark .markdown-body hr { border-top-color: #334155; }
`;

export const Editor: React.FC<EditorProps> = ({
  content,
  onChange,
  isVimMode,
  onToggleVim
}) => {
  const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('edit');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const editorRef = useRef<EditorView>();

  const insertText = useCallback((before: string, after: string = '') => {
    const view = editorRef.current;
    if (!view) return;
    
    const selection = view.state.selection.main;
    const from = selection.from;
    const to = selection.to;
    const selectedText = view.state.doc.sliceString(from, to);
    const newText = before + selectedText + after;
    
    view.dispatch({
      changes: {
        from,
        to,
        insert: newText
      },
      selection: {
        anchor: from + before.length + selectedText.length,
        head: from + before.length + selectedText.length
      }
    });
  }, []);

  const extensions: Extension[] = [markdown()];
  if (isVimMode) {
    extensions.push(vim());
  }

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-50' : ''} bg-bg-primary`}>
      <style>{markdownStyles}</style>
      <style>{`
        .cm-editor {
          height: 100% !important;
        }
        .cm-scroller {
          height: 100% !important;
        }
        .cm-content {
          min-height: 100% !important;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
          font-size: 14px !important;
          line-height: 1.6 !important;
        }
        .cm-editor {
          background-color: #ffffff !important;
        }
        .cm-scroller {
          background-color: #ffffff !important;
        }
        .cm-content {
          background-color: #ffffff !important;
          color: #1f2937 !important;
        }
        .cm-line {
          color: #1f2937 !important;
        }
        .cm-gutters {
          background-color: #f9fafb !important;
          border-right: 1px solid #e5e7eb !important;
        }
        .cm-activeLineGutter {
          background-color: #e5e7eb !important;
        }
        .cm-activeLine {
          background-color: #f3f4f6 !important;
        }
        .cm-selectionBackground {
          background-color: #bfdbfe !important;
        }
        .cm-cursor {
          border-left-color: #1f2937 !important;
        }
        .cm-lineNumbers {
          color: #9ca3af !important;
        }
        .dark .cm-editor { background-color: #1e293b !important; }
        .dark .cm-scroller { background-color: #1e293b !important; }
        .dark .cm-content { background-color: #1e293b !important; color: #f1f5f9 !important; }
        .dark .cm-line { color: #f1f5f9 !important; }
        .dark .cm-gutters { background-color: #0f172a !important; border-right-color: #334155 !important; }
        .dark .cm-activeLineGutter { background-color: #334155 !important; }
        .dark .cm-activeLine { background-color: #1e293b !important; }
        .dark .cm-selectionBackground { background-color: #3b82f6 !important; }
        .dark .cm-cursor { border-left-color: #f1f5f9 !important; }
        .dark .cm-lineNumbers { color: #64748b !important; }
      `}</style>

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
