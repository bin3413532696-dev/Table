import { Suggestion, SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { Editor, ReactRenderer } from '@tiptap/react';
import React from 'react';
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';

export interface WikiLinkSuggestionOptions {
  notes: Array<{ id: string; title: string }>;
}

interface SuggestionListProps {
  items: Array<{ id: string; title: string }>;
  command: (props: { id: string; name: string }) => void;
}

const SuggestionList: React.FC<SuggestionListProps> = ({ items, command }) => {
  return React.createElement('ul', {
    style: {
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
    },
  },
    items.length === 0
      ? React.createElement('li', {
          style: { padding: '0.5rem 0.75rem', color: 'var(--text-muted, #6b7280)' },
        }, '暂无匹配')
      : items.map((item, index) =>
          React.createElement('li', { key: item.id },
            React.createElement('button', {
              type: 'button',
              onClick: () => command({ id: item.id, name: item.title }),
              style: {
                width: '100%',
                padding: '0.5rem 0.75rem',
                textAlign: 'left',
                background: index === 0 ? 'var(--bg-hover, #f3f4f6)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: 'var(--text-primary, #1f2937)',
              },
            }, item.title)
          )
        )
  );
};

export const WikiLinkSuggestionExtension = Extension.create<WikiLinkSuggestionOptions>({
  name: 'wikiLinkSuggestion',

  addOptions() {
    return {
      notes: [],
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '[[',
        allowSpaces: true,
        startOfLine: false,
        pluginKey: new PluginKey('wikiLinkSuggestion'),
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return this.options.notes
            .filter((note: { id: string; title: string }) => note.title.toLowerCase().includes(q))
            .slice(0, 10);
        },
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: HTMLElement | null = null;

          return {
            onBeforeStart: (props: SuggestionProps<{ id: string; title: string }, { id: string; name: string }>) => {
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

            onStart: (props: SuggestionProps<{ id: string; title: string }, { id: string; name: string }>) => {
              if (component) {
                component.updateProps({ items: props.items, command: props.command });
              }
            },

            onUpdate: (props: SuggestionProps<{ id: string; title: string }, { id: string; name: string }>) => {
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
      }),
    ];
  },
});

export function createWikiLinkSuggestion(options: WikiLinkSuggestionOptions): Extension {
  return WikiLinkSuggestionExtension.configure(options);
}