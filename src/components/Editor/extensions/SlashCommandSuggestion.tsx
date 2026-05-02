import React from 'react';
import { CommandItem } from './SlashCommand';

interface SlashCommandSuggestionProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

export const SlashCommandSuggestion: React.FC<SlashCommandSuggestionProps> = ({
  items,
  command,
}) => {
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
        items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => command(item)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: 'var(--text-primary, #1f2937)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover, #f3f4f6)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
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