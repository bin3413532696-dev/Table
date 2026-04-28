import React, { useCallback, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
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
`;

export const Editor: React.FC<EditorProps> = ({
  content,
  onChange,
  isVimMode,
  onToggleVim
}) => {
  const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('edit');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const insertText = useCallback((before: string, after: string = '') => {
    const textarea = document.querySelector('.cm-content') as HTMLElement;
    if (!textarea) return;
    const selection = window.getSelection();
    if (!selection) return;
    const selectedText = selection.toString();
    const newText = before + selectedText + after;
    const start = content.indexOf(selectedText);
    if (start !== -1) {
      const newContent = content.slice(0, start) + newText + content.slice(start + selectedText.length);
      onChange(newContent);
    }
  }, [content, onChange]);

  const extensions: Extension[] = [markdown()];
  if (isVimMode) {
    extensions.push(vim());
  }

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-50' : ''} bg-white`}>
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
      `}</style>

      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white/80 backdrop-blur-xl">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => insertText('**', '**')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="粗体"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('*', '*')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="斜体"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('~~', '~~')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="删除线"
          >
            <Strikethrough className="w-4 h-4" />
          </button>
          <div className="w-px h-5 mx-1 bg-gray-200" />
          <button
            onClick={() => insertText('## ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="标题"
          >
            <Heading className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('- ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="无序列表"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('1. ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="有序列表"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('> ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="引用"
          >
            <Quote className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('```\n', '\n```')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="代码块"
          >
            <Code className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('[', '](url)')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="链接"
          >
            <Link className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('- [ ] ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
            title="任务列表"
          >
            <CheckSquare className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-gray-100 p-0.5">
            <button
              onClick={() => setMode('edit')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                mode === 'edit'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              编辑
            </button>
            <button
              onClick={() => setMode('split')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                mode === 'split'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              分屏
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                mode === 'preview'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              预览
            </button>
          </div>

          <button
            onClick={onToggleVim}
            className={`px-2 py-1.5 text-sm rounded-md transition-colors ${
              isVimMode
                ? 'bg-green-100 text-green-700'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            Vim
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-md transition-colors hover:bg-gray-100 text-gray-500"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {mode === 'edit' && (
          <CodeMirror
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
            <div className="w-1/2 border-r border-gray-200">
              <CodeMirror
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
            <div className="w-1/2 overflow-y-auto p-4 text-gray-900 bg-white">
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {mode === 'preview' && (
          <div className="h-full overflow-y-auto p-4 text-gray-900 bg-white">
            <div className="markdown-body max-w-3xl mx-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
