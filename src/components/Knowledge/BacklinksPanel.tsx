import React from 'react';
import { ArrowUpLeft, FileText } from 'lucide-react';

interface Backlink {
  sourceId: string;
  sourceTitle: string;
  context: string;
}

interface BacklinksPanelProps {
  backlinks: Backlink[];
  onNavigate: (noteId: string) => void;
}

export default function BacklinksPanel({ backlinks, onNavigate }: BacklinksPanelProps) {
  if (backlinks.length === 0) {
    return (
      <div className="p-4 bg-bg-card border border-border-primary rounded-lg">
        <h3 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
          <ArrowUpLeft className="w-4 h-4" />
          反向链接
        </h3>
        <p className="text-sm text-text-muted text-center py-4">
          暂无笔记链接到此页面
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-bg-card border border-border-primary rounded-lg">
      <h3 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
        <ArrowUpLeft className="w-4 h-4" />
        反向链接 ({backlinks.length})
      </h3>
      <div className="space-y-2">
        {backlinks.map((backlink) => (
          <button
            key={backlink.sourceId}
            onClick={() => onNavigate(backlink.sourceId)}
            className="w-full p-3 text-left bg-bg-secondary rounded-lg hover:bg-bg-tertiary transition-colors"
          >
            <div className="flex items-start gap-2">
              <FileText className="w-4 h-4 text-text-muted mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-sm text-text-primary">
                  {backlink.sourceTitle}
                </div>
                <div className="text-xs text-text-muted mt-1 line-clamp-2">
                  {backlink.context}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}