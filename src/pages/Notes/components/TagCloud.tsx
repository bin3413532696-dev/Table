import React, { useMemo } from 'react';
import { Tag } from 'lucide-react';
import { Note } from '../../../db';

interface TagCloudProps {
  notes: Note[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
}

export const TagCloud: React.FC<TagCloudProps> = ({
  notes,
  selectedTags,
  onToggleTag
}) => {
  const tagStats = useMemo(() => {
    const stats: Record<string, number> = {};
    notes.forEach(note => {
      (note.tags || []).forEach(tag => {
        stats[tag] = (stats[tag] || 0) + 1;
      });
    });
    return Object.entries(stats).sort((a, b) => b[1] - a[1]);
  }, [notes]);

  const maxCount = tagStats.length > 0 ? tagStats[0][1] : 0;
  const minCount = tagStats.length > 0 ? tagStats[tagStats.length - 1][1] : 0;

  const getTagSize = (count: number) => {
    if (maxCount === minCount) return 14;
    const normalized = (count - minCount) / (maxCount - minCount);
    return 12 + normalized * 8;
  };

  if (tagStats.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted">
        <Tag className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">暂无标签</p>
      </div>
    );
  }

  return (
    <div className="p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 text-text-muted">
        标签云
      </h3>
      <div className="flex flex-wrap gap-2">
        {tagStats.map(([tag, count]) => (
          <button
            key={tag}
            onClick={() => onToggleTag(tag)}
            className={`px-2 py-1 rounded-full text-sm transition-all ${
              selectedTags.includes(tag)
                ? 'bg-primary text-white'
                : 'bg-bg-tertiary text-text-secondary hover:bg-border-primary'
            }`}
            style={{ fontSize: `${getTagSize(count)}px` }}
          >
            {tag}
            <span className={`ml-1 text-xs ${selectedTags.includes(tag) ? 'text-white/70' : 'text-text-muted'}`}>
              {count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
