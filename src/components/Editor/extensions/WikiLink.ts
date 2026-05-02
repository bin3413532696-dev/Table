import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export interface WikiLinkOptions {
  notes?: Array<{ id: string; title: string }>;
}

export const WikiLink = Node.create<WikiLinkOptions>({
  name: 'wikiLink',

  group: 'inline',

  inline: true,

  atom: true,

  selectable: true,

  draggable: false,

  addOptions() {
    return {
      notes: [],
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) => ({
          'data-id': attributes.id,
        }),
      },
      name: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-name'),
        renderHTML: (attributes) => ({
          'data-name': attributes.name,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="wiki-link"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            id: element.getAttribute('data-id'),
            name: element.getAttribute('data-name'),
          };
        },
      },
      {
        tag: 'a[data-wiki-link]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            id: element.getAttribute('data-id'),
            name: element.getAttribute('data-name'),
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'wiki-link',
          'data-id': node.attrs.id,
          'data-name': node.attrs.name,
          class: 'wiki-link',
        },
        HTMLAttributes
      ),
      `[[${node.attrs.name}]]`,
    ];
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\]]+)\]\]$/,
        handler: ({ state, range, match, chain }) => {
          const name = match[1].trim();
          // 尝试匹配现有笔记
          const matchedNote = this.options.notes?.find(
            (n) => n.title.toLowerCase() === name.toLowerCase()
          );
          const id = matchedNote?.id || name.toLowerCase().replace(/\s+/g, '-');
          chain().deleteRange(range).insertContent({
            type: this.name,
            attrs: {
              id,
              name,
            },
          });
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { $anchor } = this.editor.state.selection;
        if ($anchor.parent.type.name === 'wikiLink') {
          this.editor.commands.deleteSelection();
          return true;
        }
        return false;
      },
    };
  },
});