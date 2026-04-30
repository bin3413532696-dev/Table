import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { EditorState, RangeSetBuilder, Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';

// =============================================================================
// Types
// =============================================================================

type BlockType = 'paragraph' | 'heading' | 'codeblock' | 'blockquote' | 'list' | 'mathblock' | 'table';

interface BlockRange {
  from: number;
  to: number;
  type: BlockType;
}

interface ObsidianElement {
  type: 'wikilink' | 'embed' | 'tag' | 'highlight' | 'task' | 'abbreviation' | 'blockId';
  from: number;
  to: number;
  content: string;
  targetId?: string;
}

// =============================================================================
// Block Range Detection - Properly handles paragraph boundaries
// =============================================================================

/**
 * Get all block ranges in the document.
 * Blocks are separated by empty lines.
 * Special blocks (code blocks, blockquotes) are handled as atomic units.
 */
function getBlockRanges(state: EditorState): BlockRange[] {
  const blocks: BlockRange[] = [];
  const doc = state.doc;
  const fullText = doc.toString();

  let currentBlockStart = 0;
  let currentBlockType: BlockType = 'paragraph';
  let inCodeBlock = false;
  let codeBlockStart = 0;
  let inMathBlock = false;
  let mathBlockStart = 0;
  let inTable = false;
  let tableStart = 0;
  let inBlockquote = false;
  let blockquoteStart = 0;

  // Helper to flush current block
  const flushBlock = (endPos: number) => {
    if (currentBlockStart < endPos) {
      blocks.push({
        from: currentBlockStart,
        to: endPos,
        type: currentBlockType,
      });
    }
    currentBlockStart = endPos;
    currentBlockType = 'paragraph';
  };

  // Iterate through all line boundaries
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const lineText = line.text;
    const lineStart = line.from;
    const lineEnd = line.to;

    // Handle code blocks (```)
    if (!inMathBlock && lineText.startsWith('```')) {
      if (!inCodeBlock) {
        // Start of code block
        flushBlock(lineStart);
        inCodeBlock = true;
        codeBlockStart = lineStart;
      } else {
        // End of code block - include the closing ```
        inCodeBlock = false;
        blocks.push({
          from: codeBlockStart,
          to: lineEnd,
          type: 'codeblock',
        });
        currentBlockStart = lineEnd;
        currentBlockType = 'paragraph';
        continue;
      }
    }

    // Handle math blocks ($$)
    if (lineText.startsWith('$$')) {
      if (!inMathBlock) {
        flushBlock(lineStart);
        inMathBlock = true;
        mathBlockStart = lineStart;
      } else {
        // End of math block
        inMathBlock = false;
        blocks.push({
          from: mathBlockStart,
          to: lineEnd,
          type: 'mathblock',
        });
        currentBlockStart = lineEnd;
        currentBlockType = 'paragraph';
        continue;
      }
    }

    // Handle blockquotes (>)
    if (lineText.startsWith('> ')) {
      if (!inBlockquote) {
        if (!inCodeBlock) flushBlock(lineStart);
        inBlockquote = true;
        blockquoteStart = lineStart;
      }
      // Continue blockquote
      if (i === doc.lines) {
        blocks.push({
          from: blockquoteStart,
          to: lineEnd,
          type: 'blockquote',
        });
      }
      continue;
    } else if (inBlockquote && lineText.trim() === '') {
      // End of blockquote at empty line
      blocks.push({
        from: blockquoteStart,
        to: lineStart, // Before the empty line
        type: 'blockquote',
      });
      inBlockquote = false;
      currentBlockStart = lineStart;
      currentBlockType = 'paragraph';
      continue;
    } else if (inBlockquote) {
      // Still in blockquote but current line doesn't start with > 
      // This can happen with continuation lines
      if (!lineText.startsWith('>')) {
        // Check if it's actually a new block
        const nextNonEmptyLine = findNextNonEmptyLine(state, i + 1);
        if (nextNonEmptyLine !== -1 && !doc.line(nextNonEmptyLine).text.startsWith('> ')) {
          blocks.push({
            from: blockquoteStart,
            to: lineStart,
            type: 'blockquote',
          });
          inBlockquote = false;
          currentBlockStart = lineStart;
          currentBlockType = 'paragraph';
        }
      }
    }

    // Handle tables (|)
    if (lineText.trim().startsWith('|')) {
      if (!inTable) {
        if (!inCodeBlock && !inMathBlock) flushBlock(lineStart);
        inTable = true;
        tableStart = lineStart;
      }
      // Continue table - check if next line is also a table row
      const nextLineNum = i + 1;
      if (nextLineNum <= doc.lines) {
        const nextLine = doc.line(nextLineNum);
        if (!nextLine.text.trim().startsWith('|')) {
          // End of table
          inTable = false;
          blocks.push({
            from: tableStart,
            to: lineEnd,
            type: 'table',
          });
          currentBlockStart = lineEnd;
          currentBlockType = 'paragraph';
        }
      } else {
        // Last line is table
        inTable = false;
        blocks.push({
          from: tableStart,
          to: lineEnd,
          type: 'table',
        });
        currentBlockStart = lineEnd;
        currentBlockType = 'paragraph';
      }
      continue;
    }

    // Handle headings (#)
    if (lineText.match(/^#+\s+/)) {
      if (!inCodeBlock && !inMathBlock) {
        flushBlock(lineStart);
        currentBlockStart = lineEnd;
        blocks.push({ from: lineStart, to: lineEnd, type: 'heading' });
        currentBlockType = 'paragraph';
        continue;
      }
    }

    // Handle horizontal rules (---)
    if (lineText.match(/^[-*_]{3,}\s*$/)) {
      if (!inCodeBlock && !inMathBlock) {
        flushBlock(lineStart);
        blocks.push({ from: lineStart, to: lineEnd, type: 'paragraph' }); // Treat as paragraph for decoration
        currentBlockStart = lineEnd;
        continue;
      }
    }

    // Empty line = paragraph boundary
    if (lineText.trim() === '') {
      if (!inCodeBlock && !inMathBlock) {
        flushBlock(lineStart);
      }
      continue;
    }

    // Non-empty, non-special line - continue current paragraph
    if (i === doc.lines && currentBlockStart < lineEnd) {
      flushBlock(lineEnd);
    }
  }

  return blocks;
}

function findNextNonEmptyLine(state: EditorState, fromLine: number): number {
  for (let i = fromLine; i <= state.doc.lines; i++) {
    if (state.doc.line(i).text.trim() !== '') {
      return i;
    }
  }
  return -1;
}

/**
 * Get the block range containing the cursor position
 */
function getActiveBlock(state: EditorState): BlockRange | null {
  const sel = state.selection.main;
  const pos = sel.head;
  const blocks = getBlockRanges(state);

  for (const block of blocks) {
    if (pos >= block.from && pos <= block.to) {
      return block;
    }
  }

  // Fallback: return paragraph around cursor
  return {
    from: Math.max(0, pos - 100),
    to: Math.min(state.doc.length, pos + 100),
    type: 'paragraph',
  };
}

/**
 * Check if a position is within the active block
 */
function isInActiveBlock(pos: number, activeBlock: BlockRange | null): boolean {
  if (!activeBlock) return false;
  return pos >= activeBlock.from && pos <= activeBlock.to;
}

// =============================================================================
// Obsidian Extended Syntax Parsing
// =============================================================================

function parseObsidianSyntax(text: string, fromOffset: number): ObsidianElement[] {
  const elements: ObsidianElement[] = [];

  // Wiki links [[note]] or [[note|alias]]
  const wikilinkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
  let match;
  while ((match = wikilinkRegex.exec(text)) !== null) {
    elements.push({
      type: 'wikilink',
      from: fromOffset + match.index,
      to: fromOffset + match.index + match[0].length,
      content: match[1],
      targetId: match[2] || undefined,
    });
  }

  // Internal embeds ![[image.png]] or ![[note]]
  const embedRegex = /!\[\[([^\]]+?)(?:\|([^\]]+?))?\]\]/g;
  while ((match = embedRegex.exec(text)) !== null) {
    elements.push({
      type: 'embed',
      from: fromOffset + match.index,
      to: fromOffset + match.index + match[0].length,
      content: match[1],
      targetId: match[2] || undefined,
    });
  }

  // Inline tags #tag or #folder/tag
  const tagRegex = /(?:^|[^\w/])#(\w+(?:[/]\w+)*)/g;
  while ((match = tagRegex.exec(text)) !== null) {
    // Check it's not inside a link or code
    const beforeChar = text[match.index - 1];
    if (beforeChar === '[' || beforeChar === '`') continue;
    elements.push({
      type: 'tag',
      from: fromOffset + match.index + (match[0].startsWith('#') ? 0 : match[0].indexOf('#')),
      to: fromOffset + match.index + match[0].length,
      content: match[1],
    });
  }

  // Highlights ==text==
  const highlightRegex = /==([^=]+)==/g;
  while ((match = highlightRegex.exec(text)) !== null) {
    elements.push({
      type: 'highlight',
      from: fromOffset + match.index,
      to: fromOffset + match.index + match[0].length,
      content: match[1],
    });
  }

  // Task list items - correct position calculation
  const taskRegex = /^(\s*)(\- \[)([ xX])(\]\s)/gm;
  while ((match = taskRegex.exec(text)) !== null) {
    // match[1] = whitespace before, match[2] = '- [', match[3] = x/space, match[4] = ']'
    elements.push({
      type: 'task',
      from: fromOffset + match.index + match[1].length,
      to: fromOffset + match.index + match[1].length + match[2].length + match[3].length,
      content: match[3],
    });
  }

  // Abbreviations *[abbr]: definition
  const abbrRegex = /^\*\[([^\]]+)\]:\s*(.+)$/gm;
  while ((match = abbrRegex.exec(text)) !== null) {
    elements.push({
      type: 'abbreviation',
      from: fromOffset + match.index,
      to: fromOffset + match.index + match[0].length,
      content: match[1],
    });
  }

  // Block IDs ^block-id
  const blockIdRegex = /\^([a-zA-Z0-9-_]+)/g;
  while ((match = blockIdRegex.exec(text)) !== null) {
    elements.push({
      type: 'blockId',
      from: fromOffset + match.index,
      to: fromOffset + match.index + match[0].length,
      content: match[1],
    });
  }

  return elements;
}

// =============================================================================
// Widget Types
// =============================================================================

class TaskCheckboxWidget extends WidgetType {
  constructor(private checked: boolean) {
    super();
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = `md-task-checkbox ${this.checked ? 'checked' : ''}`;
    span.contentEditable = 'false';
    return span;
  }

  eq(other: TaskCheckboxWidget) {
    return this.checked === other.checked;
  }

  get estimatedHeight() { return 20; }
}

class WikilinkWidget extends WidgetType {
  constructor(private content: string, private alias?: string) {
    super();
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'md-wikilink-widget';
    span.textContent = this.alias || this.content;
    span.contentEditable = 'false';
    return span;
  }

  eq(other: WikilinkWidget) {
    return this.content === other.content && this.alias === other.alias;
  }

  get estimatedHeight() { return 20; }
}

class TagWidget extends WidgetType {
  constructor(private content: string) {
    super();
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'md-tag-widget';
    span.textContent = '#' + this.content;
    span.contentEditable = 'false';
    return span;
  }

  eq(other: TagWidget) {
    return this.content === other.content;
  }

  get estimatedHeight() { return 20; }
}

class EmbedWidget extends WidgetType {
  constructor(private content: string) {
    super();
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'md-embed-widget';
    span.textContent = ' ![[' + this.content + ']] ';
    span.contentEditable = 'false';
    return span;
  }

  eq(other: EmbedWidget) {
    return this.content === other.content;
  }

  get estimatedHeight() { return 20; }
}

// =============================================================================
// Decoration Definitions
// =============================================================================

const decorations = {
  // Headings
  heading1: Decoration.mark({
    class: 'md-heading md-heading-1',
    attributes: { 'data-level': '1' }
  }),
  heading2: Decoration.mark({
    class: 'md-heading md-heading-2',
    attributes: { 'data-level': '2' }
  }),
  heading3: Decoration.mark({
    class: 'md-heading md-heading-3',
    attributes: { 'data-level': '3' }
  }),
  heading4: Decoration.mark({
    class: 'md-heading md-heading-4',
    attributes: { 'data-level': '4' }
  }),
  heading5: Decoration.mark({
    class: 'md-heading md-heading-5',
    attributes: { 'data-level': '5' }
  }),
  heading6: Decoration.mark({
    class: 'md-heading md-heading-6',
    attributes: { 'data-level': '6' }
  }),

  // Inline formatting
  strong: Decoration.mark({ class: 'md-strong' }),
  emphasis: Decoration.mark({ class: 'md-emphasis' }),
  strikethrough: Decoration.mark({ class: 'md-strikethrough' }),
  inlineCode: Decoration.mark({ class: 'md-inline-code' }),

  // Code blocks
  codeBlock: Decoration.mark({
    class: 'md-code-block',
    attributes: { 'data-lang': '' }
  }),

  // Links
  linkText: Decoration.mark({ class: 'md-link-text' }),
  url: Decoration.mark({ class: 'md-url' }),

  // Wiki links
  wikilink: Decoration.mark({ class: 'md-wikilink' }),
  wikilinkAlias: Decoration.mark({ class: 'md-wikilink-alias' }),

  // Tags
  tag: Decoration.mark({ class: 'md-tag' }),

  // Highlights
  highlight: Decoration.mark({ class: 'md-highlight' }),

  // Block elements
  blockquote: Decoration.mark({ class: 'md-blockquote' }),
  blockquoteMark: Decoration.mark({ class: 'md-blockquote-mark' }),
  listItem: Decoration.mark({ class: 'md-list-item' }),
  listMarker: Decoration.mark({ class: 'md-list-marker' }),

  // Tables
  table: Decoration.mark({ class: 'md-table' }),
  tableRow: Decoration.mark({ class: 'md-table-row' }),
  tableCell: Decoration.mark({ class: 'md-table-cell' }),
  tableHeader: Decoration.mark({ class: 'md-table-header' }),

  // Math
  mathBlock: Decoration.mark({ class: 'md-math-block' }),
  inlineMath: Decoration.mark({ class: 'md-inline-math' }),

  // Block ID
  blockId: Decoration.mark({ class: 'md-block-id' }),

  // Abbreviation
  abbreviation: Decoration.mark({ class: 'md-abbreviation' }),
  abbreviationMark: Decoration.mark({ class: 'md-abbreviation-mark' }),

  // Horizontal rule
  hr: Decoration.mark({ class: 'md-hr' }),

  // Hidden syntax (using better approach than font-size: 0)
  hiddenSyntax: Decoration.mark({
    class: 'md-syntax-hidden',
    attributes: { 'aria-hidden': 'true' }
  }),
};

// =============================================================================
// Inline Element Parsing
// =============================================================================

function parseInlineElements(
  text: string,
  offset: number,
  isActive: boolean,
  elements: Array<{ from: number; to: number; decoration: Decoration; type: string }>
): void {
  // Bold **text**
  const strongRegex = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = strongRegex.exec(text)) !== null) {
    const from = offset + match.index;
    const to = from + match[0].length;
    elements.push({ from, to, decoration: decorations.strong, type: 'strong' });
    if (!isActive) {
      elements.push({ from: from, to: from + 2, decoration: decorations.hiddenSyntax, type: 'strong-start' });
      elements.push({ from: to - 2, to: to, decoration: decorations.hiddenSyntax, type: 'strong-end' });
    }
  }

  // Italic *text* or _text_
  const emphasisRegex = /(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)|_([^_]+)_/g;
  while ((match = emphasisRegex.exec(text)) !== null) {
    const content = match[1] || match[2];
    if (!content) continue;
    const from = offset + match.index;
    const to = from + match[0].length;
    elements.push({ from, to, decoration: decorations.emphasis, type: 'emphasis' });
    if (!isActive) {
      const markLen = match[0].startsWith('_') ? 1 : 1;
      elements.push({ from: from, to: from + markLen, decoration: decorations.hiddenSyntax, type: 'emphasis-start' });
      elements.push({ from: to - markLen, to: to, decoration: decorations.hiddenSyntax, type: 'emphasis-end' });
    }
  }

  // Strikethrough ~~text~~
  const strikeRegex = /~~([^~]+)~~/g;
  while ((match = strikeRegex.exec(text)) !== null) {
    const from = offset + match.index;
    const to = from + match[0].length;
    elements.push({ from, to, decoration: decorations.strikethrough, type: 'strikethrough' });
    if (!isActive) {
      elements.push({ from: from, to: from + 2, decoration: decorations.hiddenSyntax, type: 'strike-start' });
      elements.push({ from: to - 2, to: to, decoration: decorations.hiddenSyntax, type: 'strike-end' });
    }
  }

  // Inline code `code`
  const codeRegex = /`([^`]+)`/g;
  while ((match = codeRegex.exec(text)) !== null) {
    const from = offset + match.index;
    const to = from + match[0].length;
    elements.push({ from, to, decoration: decorations.inlineCode, type: 'inline-code' });
    if (!isActive) {
      elements.push({ from: from, to: from + 1, decoration: decorations.hiddenSyntax, type: 'code-start' });
      elements.push({ from: to - 1, to: to, decoration: decorations.hiddenSyntax, type: 'code-end' });
    }
  }

  // Links [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(text)) !== null) {
    const from = offset + match.index;
    const to = from + match[0].length;
    const textStart = from + 1;
    const textEnd = textStart + match[1].length;

    elements.push({ from: textStart, to: textEnd, decoration: decorations.linkText, type: 'link-text' });
    elements.push({ from: textEnd + 1, to: to - 1, decoration: decorations.url, type: 'url' });

    if (!isActive) {
      elements.push({ from: from, to: from + 1, decoration: decorations.hiddenSyntax, type: 'link-start' });
      elements.push({ from: textEnd, to: textEnd + 1, decoration: decorations.hiddenSyntax, type: 'link-url-start' });
      elements.push({ from: to - 1, to: to, decoration: decorations.hiddenSyntax, type: 'link-url-end' });
    }
  }

  // Inline math $...$
  const inlineMathRegex = /\$([^$\n]+)\$/g;
  while ((match = inlineMathRegex.exec(text)) !== null) {
    const from = offset + match.index;
    const to = from + match[0].length;
    elements.push({ from, to, decoration: decorations.inlineMath, type: 'inline-math' });
    if (!isActive) {
      elements.push({ from: from, to: from + 1, decoration: decorations.hiddenSyntax, type: 'math-start' });
      elements.push({ from: to - 1, to: to, decoration: decorations.hiddenSyntax, type: 'math-end' });
    }
  }
}

// =============================================================================
// Build Decorations
// =============================================================================

function buildDecorations(state: EditorState, activeBlock: BlockRange | null): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const docText = state.doc.toString();

  // Parse Obsidian syntax elements
  const obsidianElements = parseObsidianSyntax(docText, 0);

  // Collect all decoration ranges
  const allElements: Array<{ from: number; to: number; decoration: Decoration; type: string }> = [];

  // Process each block type
  const blocks = getBlockRanges(state);

  for (const block of blocks) {
    const isActive = isInActiveBlock(block.from, activeBlock);
    const blockText = state.doc.sliceString(block.from, block.to);

    switch (block.type) {
      case 'heading': {
        // Apply heading decoration to entire line
        const headingMatch = blockText.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
          const level = Math.min(headingMatch[1].length, 6);
          const headingStyle = decorations[`heading${level}` as keyof typeof decorations] || decorations.heading1;

          allElements.push({
            from: block.from,
            to: block.to,
            decoration: headingStyle,
            type: 'heading'
          });

          // Hide # markers in inactive blocks
          if (!isActive) {
            const markerEnd = block.from + headingMatch[1].length;
            allElements.push({
              from: block.from,
              to: markerEnd,
              decoration: decorations.hiddenSyntax,
              type: 'heading-mark'
            });
          }
        }
        break;
      }

      case 'codeblock': {
        allElements.push({
          from: block.from,
          to: block.to,
          decoration: decorations.codeBlock,
          type: 'codeblock'
        });
        break;
      }

      case 'mathblock': {
        allElements.push({
          from: block.from,
          to: block.to,
          decoration: decorations.mathBlock,
          type: 'mathblock'
        });
        break;
      }

      case 'blockquote': {
        // Apply to each line in blockquote
        let lineStart = block.from;
        const lines = blockText.split('\n');
        for (const line of lines) {
          if (line.startsWith('> ')) {
            allElements.push({
              from: lineStart,
              to: lineStart + 2,
              decoration: decorations.blockquoteMark,
              type: 'blockquote-mark'
            });
            allElements.push({
              from: lineStart + 2,
              to: lineStart + line.length,
              decoration: decorations.blockquote,
              type: 'blockquote'
            });
          } else if (line.startsWith('>')) {
            allElements.push({
              from: lineStart,
              to: lineStart + 1,
              decoration: decorations.blockquoteMark,
              type: 'blockquote-mark'
            });
            allElements.push({
              from: lineStart + 1,
              to: lineStart + line.length,
              decoration: decorations.blockquote,
              type: 'blockquote'
            });
          }
          lineStart += line.length + 1; // +1 for newline
        }
        break;
      }

      case 'table': {
        const lines = blockText.split('\n');
        let rowStart = block.from;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const isHeader = i === 0;

          // Parse table cells
          const cells = line.split('|').filter((_, idx) => idx !== 0 && idx !== line.split('|').length - 1);

          let cellStart = rowStart;
          for (const cell of cells) {
            const trimmedCell = cell.trim();
            const cellLength = cell.length;
            const trimmedLength = cell.length - cell.trimStart().length - cell.trimEnd().length;

            if (isHeader) {
              allElements.push({
                from: cellStart + cell.trimStart().length,
                to: cellStart + cellLength - cell.trimEnd().length,
                decoration: decorations.tableHeader,
                type: 'table-header'
              });
            } else {
              allElements.push({
                from: cellStart + cell.trimStart().length,
                to: cellStart + cellLength - cell.trimEnd().length,
                decoration: decorations.tableCell,
                type: 'table-cell'
              });
            }
            cellStart += cellLength + 1; // +1 for |
          }

          // Hide table syntax if inactive
          if (!isActive) {
            // Hide | at start
            allElements.push({
              from: rowStart,
              to: rowStart + 1,
              decoration: decorations.hiddenSyntax,
              type: 'table-start'
            });
            // Hide | between cells and at end
            let pipePos = rowStart;
            for (let p = 0; p < line.length; p++) {
              if (line[p] === '|') {
                allElements.push({
                  from: pipePos,
                  to: pipePos + 1,
                  decoration: decorations.hiddenSyntax,
                  type: 'table-sep'
                });
              }
              pipePos++;
            }
          }

          rowStart += line.length + 1;
        }
        break;
      }

      case 'list': {
        // Handle lists - this is simplified, actual list handling may be more complex
        const lines = blockText.split('\n');
        let lineStart = block.from;

        for (const line of lines) {
          const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (listMatch) {
            const indentLen = listMatch[1].length;
            const markerLen = listMatch[2].length;
            const markerEnd = lineStart + indentLen + markerLen + 1;

            allElements.push({
              from: lineStart,
              to: lineStart + line.length,
              decoration: decorations.listItem,
              type: 'list-item'
            });

            allElements.push({
              from: lineStart + indentLen,
              to: markerEnd,
              decoration: decorations.listMarker,
              type: 'list-marker'
            });

            if (!isActive) {
              allElements.push({
                from: lineStart + indentLen,
                to: markerEnd,
                decoration: decorations.hiddenSyntax,
                type: 'list-marker-hidden'
              });
            }

            // Parse inline elements in list content
            const contentOffset = lineStart + indentLen + markerLen + 1;
            const content = line.substring(indentLen + markerLen + 1);
            parseInlineElements(content, contentOffset, isActive, allElements);
          }
          lineStart += line.length + 1;
        }
        break;
      }

      case 'paragraph':
      default: {
        // Handle paragraphs - process line by line
        const lines = blockText.split('\n');
        let lineStart = block.from;

        for (const line of lines) {
          // Check for HR
          if (line.match(/^[-*_]{3,}\s*$/)) {
            allElements.push({
              from: lineStart,
              to: lineStart + line.length,
              decoration: decorations.hr,
              type: 'hr'
            });
          } else {
            // Parse inline elements
            parseInlineElements(line, lineStart, isActive, allElements);
          }
          lineStart += line.length + 1;
        }
        break;
      }
    }
  }

  // Process Obsidian elements
  for (const elem of obsidianElements) {
    const isActive = isInActiveBlock(elem.from, activeBlock);

    switch (elem.type) {
      case 'wikilink': {
        // Wiki link decoration
        allElements.push({
          from: elem.from,
          to: elem.to,
          decoration: decorations.wikilink,
          type: 'wikilink'
        });

        // Hide [[ and ]] in inactive blocks
        if (!isActive) {
          allElements.push({
            from: elem.from,
            to: elem.from + 2,
            decoration: decorations.hiddenSyntax,
            type: 'wikilink-start'
          });
          allElements.push({
            from: elem.to - 2,
            to: elem.to,
            decoration: decorations.hiddenSyntax,
            type: 'wikilink-end'
          });
        }
        break;
      }

      case 'embed': {
        // Embed decoration - keep visible but styled
        allElements.push({
          from: elem.from,
          to: elem.to,
          decoration: decorations.wikilink, // Reuse wikilink style
          type: 'embed'
        });
        break;
      }

      case 'tag': {
        allElements.push({
          from: elem.from,
          to: elem.to,
          decoration: decorations.tag,
          type: 'tag'
        });
        break;
      }

      case 'highlight': {
        allElements.push({
          from: elem.from,
          to: elem.to,
          decoration: decorations.highlight,
          type: 'highlight'
        });

        if (!isActive) {
          allElements.push({
            from: elem.from,
            to: elem.from + 2,
            decoration: decorations.hiddenSyntax,
            type: 'highlight-start'
          });
          allElements.push({
            from: elem.to - 2,
            to: elem.to,
            decoration: decorations.hiddenSyntax,
            type: 'highlight-end'
          });
        }
        break;
      }

      case 'blockId': {
        allElements.push({
          from: elem.from,
          to: elem.to,
          decoration: decorations.blockId,
          type: 'blockId'
        });

        if (!isActive) {
          allElements.push({
            from: elem.from,
            to: elem.from + 1,
            decoration: decorations.hiddenSyntax,
            type: 'blockid-mark'
          });
        }
        break;
      }
    }
  }

  // Sort by position
  allElements.sort((a, b) => a.from - b.from);

  // Build final decoration set (handle overlaps by keeping first)
  let pos = 0;
  for (const elem of allElements) {
    if (elem.from >= pos) {
      builder.add(elem.from, elem.to, elem.decoration);
      pos = elem.to;
    }
  }

  return builder.finish();
}

// =============================================================================
// Live Preview Plugin with Caching
// =============================================================================

export const livePreviewPlugin = ViewPlugin.fromClass(
  class LivePreviewPlugin {
    decorations: DecorationSet;
    activeBlock: BlockRange | null;

    constructor(view: EditorView) {
      this.activeBlock = getActiveBlock(view.state);
     this.decorations = buildDecorations(view.state, this.activeBlock);
    }

    update(update: ViewUpdate) {
      // Only rebuild when necessary
      if (update.docChanged) {
        // Full rebuild on document change
        this.activeBlock = getActiveBlock(update.state);
        this.decorations = buildDecorations(update.state, this.activeBlock);
      } else if (update.selectionSet) {
        // Check if cursor moved to a different block
        const newActiveBlock = getActiveBlock(update.state);
        if (newActiveBlock?.from !== this.activeBlock?.from || newActiveBlock?.to !== this.activeBlock?.to) {
          this.activeBlock = newActiveBlock;
          this.decorations = buildDecorations(update.state, this.activeBlock);
        }
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// =============================================================================
// Export Extensions
// =============================================================================

export function getLivePreviewExtensions(): Extension[] {
  return [
    livePreviewPlugin,
    markdown(),
  ];
}