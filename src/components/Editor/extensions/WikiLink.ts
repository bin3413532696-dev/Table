import { Node, mergeAttributes } from '@tiptap/core';

export const WikiLink = Node.create({
  name: 'wikiLink',

  group: 'inline',

  inline: true,

  atom: true,

  selectable: true,

  draggable: false,

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