import React from 'react';
import { Suggestion, SuggestionKeyDownProps, SuggestionListProps } from '@tiptap/suggestion';
import { Editor, ReactRenderer } from '@tiptap/react';

export interface WikiLinkSuggestionOptions {
  notes: Array<{ id: string; title: string }>;
}

interface SuggestionListComponentProps extends SuggestionListProps {
  items: Array<{ id: string; title: string }>;
}

const SuggestionList: React.FC<SuggestionListComponentProps> = ({ items, command }) => {
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '0.25rem',
        background: 'var(--bg-card, #fff)',
        border: '1px solid var(--border-primary, #e5e7eb)',
        borderRadius: '0.375rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        maxHeight: '16rem',
        overflow: 'auto',
        minWidth: '12rem',
        zIndex: 50,
      }}
    >
      {items.length === 0 ? (
        <li style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted, #6b7280)' }}>
          暂无匹配
        </li>
      ) : (
        items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => command({ id: item.id, name: item.title })}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                textAlign: 'left',
                background: index === 0 ? 'var(--bg-hover, #f3f4f6)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: 'var(--text-primary, #1f2937)',
              }}
            >
              {item.title}
            </button>
          </li>
        ))
      )}
    </ul>
  );
};

export const createWikiLinkSuggestion = (options: WikiLinkSuggestionOptions) => {
  return Suggestion.configure({
    char: '[[',
    allowSpaces: true,
    startOfLine: false,
    items: ({ query }: { query: string }) => {
      const q = query.toLowerCase();
      return options.notes
        .filter((note) => note.title.toLowerCase().includes(q))
        .slice(0, 10);
    },
    render: () => {
      let component: ReactRenderer | null = null;
      let popup: HTMLElement | null = null;

      return {
        onStart: (props: { editor: Editor; clientRect: () => DOMRect | null }) => {
          if (!props.clientRect) return;

          const wrapper = document.createElement('div');
          wrapper.style.position = 'absolute';
          wrapper.style.zIndex = '50';

          popup = wrapper;
          document.body.appendChild(popup);

          component = new ReactRenderer(SuggestionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          });

          const rect = props.clientRect();
          if (rect) {
            popup.style.left = `${rect.left}px`;
            popup.style.top = `${rect.bottom + 4}px`;
          }

          const element = component.element;
          if (element && popup) {
            popup.appendChild(element);
          }
        },

        onUpdate: (props: { editor: Editor; clientRect: () => DOMRect | null }) => {
          component?.updateProps({ items: props.items, command: props.command });

          if (!props.clientRect || !popup) return;

          const rect = props.clientRect();
          if (rect) {
            popup.style.left = `${rect.left}px`;
            popup.style.top = `${rect.bottom + 4}px`;
          }
        },

        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === 'Escape') {
            popup?.remove();
            component?.destroy();
            return true;
          }
          return false;
        },

        onExit: () => {
          popup?.remove();
          component?.destroy();
        },
      };
    },
    command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: { id: string; name: string } }) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: 'wikiLink',
        attrs: {
          id: props.id,
          name: props.name,
        },
      }).run();
    },
  });
};