import React from 'react';
import { FileText, Tag, Clock } from 'lucide-react';
import type { KnowledgeNote } from '../types';

interface NoteCardProps {
  note: KnowledgeNote;
  onClick: () => void;
  presetTags: { id: string; name: string; color: string }[];
}

export function NoteCard({ note, onClick, presetTags }: NoteCardProps) {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const getPreview = (content: string, maxLength: number = 120) => {
    const text = content
      .replace(/<[^>]*>/g, '')
      .replace(/\n/g, ' ')
      .trim();
    return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
  };

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer p-4 border rounded-lg hover:border-blue-300 hover:shadow-sm transition-all bg-white dark:bg-gray-900"
    >
      <div className="flex items-start gap-3">
        <FileText className="text-gray-400 mt-1" size={18} />
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600">
            {note.title}
          </h3>
          {note.content && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
              {getPreview(note.content)}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {note.tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <Tag size={12} className="text-gray-400" />
                {note.tags.slice(0, 3).map((tag) => {
                  const preset = presetTags.find((p) => p.name === tag);
                  return (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: preset ? `${preset.color}20` : '#6B728020',
                        color: preset ? preset.color : '#6B7280',
                      }}
                    >
                      {tag}
                    </span>
                  );
                })}
                {note.tags.length > 3 && (
                  <span className="text-xs text-gray-400">
                    +{note.tags.length - 3}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 text-xs text-gray-400 ml-auto">
              <Clock size={12} />
              {formatDate(note.updatedAt)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}