import { Suggestion, SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { Editor, ReactRenderer } from '@tiptap/react';
import React from 'react';
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { SlashCommandSuggestion } from './SlashCommandSuggestion';
import { CommandItem, filterCommands } from './SlashCommand';

export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        pluginKey: new PluginKey('slashCommand'),
        items: ({ query }: { query: string }) => {
          return filterCommands(query);
        },
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: HTMLElement | null = null;

          return {
            onBeforeStart: (props: SuggestionProps<CommandItem, CommandItem>) => {
              if (!props.clientRect) return;

              const wrapper = document.createElement('div');
              wrapper.style.position = 'absolute';
              wrapper.style.zIndex = '50';

              popup = wrapper;
              document.body.appendChild(popup);

              component = new ReactRenderer(SlashCommandSuggestion, {
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

            onStart: (props: SuggestionProps<CommandItem, CommandItem>) => {
              if (component) {
                component.updateProps({ items: props.items, command: props.command });
              }
            },

            onUpdate: (props: SuggestionProps<CommandItem, CommandItem>) => {
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
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: { from: number; to: number };
          props: CommandItem;
        }) => {
          editor.chain().focus().deleteRange(range).run();
          props.command(editor);
        },
      }),
    ];
  },
});