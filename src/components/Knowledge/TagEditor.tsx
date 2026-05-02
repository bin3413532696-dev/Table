import React, { useState, useRef, useEffect } from 'react';
import { X, Plus, Tag } from 'lucide-react';

interface TagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestedTags?: string[];
}

export default function TagEditor({ tags, onChange, suggestedTags = [] }: TagEditorProps) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 过滤出未被使用的建议标签
  const availableSuggestions = suggestedTags.filter(
    (s) => !tags.includes(s) && s.toLowerCase().includes(input.toLowerCase())
  );

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput('');
    setShowSuggestions(false);
  };

  const handleRemoveTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      handleAddTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      handleRemoveTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    setShowSuggestions(input.length > 0 && availableSuggestions.length > 0);
  }, [input, availableSuggestions.length]);

  return (
    <div className="tag-editor relative">
      <div className="flex items-center gap-1 mb-1">
        <Tag className="w-3 h-3 text-text-muted" />
        <span className="text-xs text-text-muted">标签</span>
      </div>
      <div className="flex flex-wrap gap-1 items-center p-2 border border-border-primary rounded-lg bg-bg-card">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-xs"
          >
            {tag}
            <button
              onClick={() => handleRemoveTag(tag)}
              className="hover:text-rose-500 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => input && setShowSuggestions(availableSuggestions.length > 0)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={tags.length === 0 ? '添加标签...' : ''}
          className="flex-1 min-w-[80px] text-xs outline-none bg-transparent"
        />
      </div>

      {/* 建议标签下拉 */}
      {showSuggestions && availableSuggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full p-1 border border-border-primary rounded-lg bg-bg-card shadow-lg">
          {availableSuggestions.slice(0, 5).map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => handleAddTag(suggestion)}
              className="w-full px-2 py-1 text-xs text-left hover:bg-bg-secondary rounded"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}