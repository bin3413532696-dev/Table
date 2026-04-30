import React, { useCallback, useRef, useEffect, useState } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { EditorState, Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { vim } from '@replit/codemirror-vim';
import { history } from '@codemirror/commands';
import { lineNumbers, highlightActiveLineGutter, highlightActiveLine } from '@codemirror/view';
import { getLivePreviewExtensions } from './markdownDecorations';
import './editor.css';
import { Bold, Italic, Strikethrough, Heading, List, ListOrdered, Quote, Code, Link, CheckSquare, Maximize2, Minimize2, Save, Check, Highlighter, Tag, Brackets } from 'lucide-react';
import { useTheme } from '../../../../contexts/ThemeContext';
import { Note } from '../../../../db';

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  isVimMode: boolean;
  onToggleVim: () => void;
  // 分屏模式：第二个笔记
  secondNote?: Note | null;
  secondContent?: string;
  onSecondChange?: (content: string) => void;
  // 链接点击回调
  onWikilinkClick?: (noteTitle: string) => void;
  onTagClick?: (tag: string) => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved';

export const Editor: React.FC<EditorProps> = ({
  content,
  onChange,
  isVimMode,
  onToggleVim,
  secondNote,
  secondContent = '',
  onSecondChange,
  onWikilinkClick,
  onTagClick,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const secondEditorRef = useRef<ReactCodeMirrorRef>(null);
  const { theme } = useTheme();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef(content);
  const [isSplitMode, setIsSplitMode] = useState(false);

  // 获取当前焦点的编辑器
  const getActiveEditor = useCallback(() => {
    const primary = editorRef.current?.view;
    const secondary = secondEditorRef.current?.view;

    if (primary?.hasFocus) return primary;
    if (secondary?.hasFocus) return secondary;

    return primary;
  }, []);

  // 插入文本
  const insertText = useCallback((before: string, after: string = '') => {
    const view = getActiveEditor();
    if (!view) return;

    const selection = view.state.selection.main;
    const from = selection.from;
    const to = selection.to;
    const selectedText = view.state.doc.sliceString(from, to);
    const newText = before + selectedText + after;

    let cursorPos = from + before.length + selectedText.length;

    // 链接插入时，光标定位到 URL 位置
    const urlIndex = after.indexOf('url');
    if (urlIndex !== -1) {
      cursorPos = from + before.length + selectedText.length + urlIndex;
    }

    view.dispatch({
      changes: { from, to, insert: newText },
      selection: { anchor: cursorPos, head: cursorPos }
    });
  }, [getActiveEditor]);

  // 插入 Wiki链接 [[note]]
  const insertWikilink = useCallback(() => {
    insertText('[', ']');
  }, [insertText]);

  // 插入高亮 ==text==
  const insertHighlight = useCallback(() => {
    insertText('==', '==');
  }, [insertText]);

  // 插入标签 #tag
  const insertTag = useCallback(() => {
    const view = getActiveEditor();
    if (!view) return;

    const selection = view.state.selection.main;
    const from = selection.from;
    const to = selection.to;
    const selectedText = view.state.doc.sliceString(from, to);

    const insert = selectedText ? `#${selectedText}` : '#tag';
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length }
    });
  }, [getActiveEditor]);

  // 自动保存（防抖）
  useEffect(() => {
    if (content === lastSavedContentRef.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    setSaveStatus('saving');

    saveTimerRef.current = setTimeout(() => {
      lastSavedContentRef.current = content;
      onChange(content);
      setSaveStatus('saved');

      setTimeout(() => {
        setSaveStatus('idle');
      }, 1500);
    }, 800);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [content, onChange]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const view = getActiveEditor();
      if (!view) return;

      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key === 'b') {
        e.preventDefault();
        insertText('**', '**');
      } else if (isMod && e.key === 'i') {
        e.preventDefault();
        insertText('*', '*');
      } else if (isMod && e.key === 'u') {
        e.preventDefault();
        insertText('~~', '~~');
      } else if (isMod && e.key === 'h') {
        e.preventDefault();
        insertHighlight();
      } else if (isMod && e.key === 's') {
        e.preventDefault();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        lastSavedContentRef.current = content;
        onChange(content);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 1500);
      } else if (isMod && e.key === 'k') {
        e.preventDefault();
        insertWikilink();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, onChange, insertText, insertHighlight, insertWikilink, getActiveEditor]);

  // 编辑器扩展配置
  const getExtensions = useCallback(() => {
    const ext: Extension[] = [
      // 基础设置
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),

      // Markdown 语言支持
      markdown(),

      // 实时预览装饰
      ...getLivePreviewExtensions(),

      // 编辑器样式
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          backgroundColor: 'var(--bg-primary)',
          height: '100%',
        },
        '.cm-content': {
          caretColor: 'var(--text-primary)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
        '.cm-cursor': {
          borderLeftColor: 'var(--text-primary)',
        },
      }),
    ];

    // Vim 模式
    if (isVimMode) {
      ext.push(vim());
    }

    return ext;
  }, [isVimMode]);

  // 保存状态显示
  const renderSaveStatus = () => {
    if (saveStatus === 'idle') return null;
    return (
      <div className="flex items-center gap-1 text-xs">
        {saveStatus === 'saving' ? (
          <>
            <Save className="w-3 h-3 animate-pulse" />
            <span className="text-text-muted">保存中...</span>
          </>
        ) : (
          <>
            <Check className="w-3 h-3 text-success" />
            <span className="text-success">已保存</span>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-50' : ''} bg-bg-primary`}>
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-primary bg-bg-primary/80 backdrop-blur-xl">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => insertText('**', '**')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="粗体 (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('*', '*')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="斜体 (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={() => insertText('~~', '~~')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="删除线 (Ctrl+U)"
          >
            <Strikethrough className="w-4 h-4" />
          </button>
          <button
            onClick={insertHighlight}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="高亮 (Ctrl+H)"
          >
            <Highlighter className="w-4 h-4" />
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
            onClick={() => insertText('- [ ] ', '')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="任务列表"
          >
            <CheckSquare className="w-4 h-4" />
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
          <div className="w-px h-5 mx-1 bg-border-primary" />
          <button
            onClick={() => insertText('[', '](url)')}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="链接"
          >
            <Link className="w-4 h-4" />
          </button>
          <button
            onClick={insertWikilink}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="Wiki链接 [[note]] (Ctrl+K)"
          >
            <Brackets className="w-4 h-4" />
          </button>
          <button
            onClick={insertTag}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
            title="标签 #tag"
          >
            <Tag className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {renderSaveStatus()}

          {/* 分屏模式切换 */}
          <button
            onClick={() => setIsSplitMode(!isSplitMode)}
            className={`p-1.5 rounded-md transition-colors ${
              isSplitMode
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : 'hover:bg-bg-tertiary text-text-secondary'
            }`}
            title={isSplitMode ? '关闭分屏' : '开启分屏'}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
          </button>

          {/* Vim 模式 */}
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

          {/* 全屏 */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-md transition-colors hover:bg-bg-tertiary text-text-secondary"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 编辑器区域 */}
      <div className="flex-1 overflow-hidden flex">
        {/* 主编辑器 */}
        <div
          className={`overflow-hidden ${isSplitMode ? 'border-r border-border-primary' : ''}`}
          style={{ width: isSplitMode ? '50%' : '100%' }}
        >
          <CodeMirror
            ref={editorRef}
            value={content}
            height="100%"
            theme={theme === 'dark' ? 'dark' : 'light'}
            extensions={getExtensions()}
            onChange={(value) => {
              // 直接更新内容，不经过防抖（防抖在 effect 中处理）
              lastSavedContentRef.current = value;
            }}
            className="h-full md-live-editor"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: false,
              history: true,
              drawSelection: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              syntaxHighlighting: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: false,
              rectangularSelection: true,
              crosshairCursor: true,
              highlightSelectionMatches: true,
            }}
          />
        </div>

        {/* 分屏模式：第二个编辑器 */}
        {isSplitMode && secondNote && onSecondChange && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border-primary bg-bg-secondary truncate">
              {secondNote.title}
            </div>
            <div className="flex-1 overflow-hidden">
              <CodeMirror
                ref={secondEditorRef}
                value={secondContent}
                height="100%"
                theme={theme === 'dark' ? 'dark' : 'light'}
                extensions={getExtensions()}
                onChange={onSecondChange}
                className="h-full md-live-editor"
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLineGutter: true,
                  highlightActiveLine: true,
                  foldGutter: false,
                  history: true,
                }}
              />
            </div>
          </div>
        )}

        {/* 分屏模式：无第二个笔记时的提示 */}
        {isSplitMode && !secondNote && (
          <div className="flex-1 flex items-center justify-center text-text-muted text-sm bg-bg-secondary">
            <div className="text-center">
              <svg className="w-8 h-8 mx-auto mb-2 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="12" y1="3" x2="12" y2="21"/>
              </svg>
              <p>从左侧文件树选择另一个笔记</p>
              <p className="text-xs mt-1 opacity-70">可在分屏模式下同时编辑两个笔记</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export type EditorMode = 'edit' | 'split-edit' | 'preview';