import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Tag } from 'lucide-react';
import type { KnowledgePresetTag } from '../types';

interface TagSelectorProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  presetTags: KnowledgePresetTag[];
  allTags: string[];
  onCreatePresetTag?: (name: string, color: string) => Promise<void>;
}

const PRESET_COLORS = [
  '#EF4444',
  '#F59E0B',
  '#10B981',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
];

export function TagSelector({
  selectedTags,
  onChange,
  presetTags,
  allTags,
  onCreatePresetTag,
}: TagSelectorProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = [...presetTags, ...allTags.filter((tag) => !presetTags.some((p) => p.name === tag))]
    .filter((item) => {
      const name = typeof item === 'string' ? item : item.name;
      return name.toLowerCase().includes(inputValue.toLowerCase()) && !selectedTags.includes(name);
    })
    .slice(0, 8);

  const handleAddTag = (tag: string) => {
    if (tag.trim() && !selectedTags.includes(tag.trim())) {
      onChange([...selectedTags, tag.trim()]);
    }
    setInputValue('');
    setShowSuggestions(false);
  };

  const handleRemoveTag = (tag: string) => {
    onChange(selectedTags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      handleAddTag(inputValue.trim());
    } else if (e.key === 'Backspace' && !inputValue && selectedTags.length > 0) {
      handleRemoveTag(selectedTags[selectedTags.length - 1]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleCreatePreset = async (color: string) => {
    if (onCreatePresetTag && newTagName.trim()) {
      await onCreatePresetTag(newTagName.trim(), color);
      handleAddTag(newTagName.trim());
      setNewTagName('');
      setShowColorPicker(false);
    }
  };

  useEffect(() => {
    if (inputValue) {
      setShowSuggestions(true);
    }
  }, [inputValue]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {selectedTags.map((tag) => {
          const preset = presetTags.find((p) => p.name === tag);
          return (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-medium"
              style={{
                backgroundColor: preset ? `${preset.color}20` : '#6B728020',
                color: preset ? preset.color : '#6B7280',
              }}
            >
              <Tag size={12} />
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="ml-1 hover:opacity-70"
              >
                <X size={14} />
              </button>
            </span>
          );
        })}
      </div>

      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="添加标签..."
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border rounded-lg shadow-lg z-10 max-h-48 overflow-auto">
                {suggestions.map((item) => {
                  const isPreset = typeof item !== 'string';
                  const name = isPreset ? item.name : item;
                  const color = isPreset ? item.color : '#6B7280';
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleAddTag(name)}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm">{name}</span>
                      {isPreset && (
                        <span className="text-xs text-gray-500 ml-auto">预设</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {inputValue.trim() && !presetTags.some((p) => p.name === inputValue.trim()) && onCreatePresetTag && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => {
                setNewTagName(inputValue.trim());
                setShowColorPicker(true);
              }}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <Plus size={14} />
              创建预设标签 "{inputValue.trim()}"
            </button>
          </div>
        )}
      </div>

      {showColorPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-xl">
            <h3 className="text-lg font-medium mb-3">选择标签颜色</h3>
            <div className="flex gap-2 mb-4">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => handleCreatePreset(color)}
                  className="w-8 h-8 rounded-full hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowColorPicker(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}