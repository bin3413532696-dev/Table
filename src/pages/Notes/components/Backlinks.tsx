import React from 'react';
import { Link2, FileText } from 'lucide-react';
import { Note } from '../../../db';

interface BacklinksProps {
  currentNote: Note | null;
  notes: Note[];
  onSelectNote: (note: Note) => void;
}

export const Backlinks: React.FC<BacklinksProps> = ({
  currentNote,
  notes,
  onSelectNote
}) => {
  if (!currentNote) {
    return (
      <div className="p-4 text-center text-gray-400">
        <Link2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">选择笔记查看反向链接</p>
      </div>
    );
  }

  const backlinks = notes.filter(note => 
    note.id !== currentNote.id && 
    (note.links || []).includes(currentNote.title)
  );

  const outgoingLinks = (currentNote.links || []).map(title => 
    notes.find(n => n.title === title)
  ).filter(Boolean) as Note[];

  return (
    <div className="p-3 flex flex-col h-full">
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 text-gray-500">
        反向链接
      </h3>

      {outgoingLinks.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs mb-2 text-gray-500">
            出链 ({outgoingLinks.length})
          </h4>
          <div className="space-y-0.5">
            {outgoingLinks.map(note => (
              <button
                key={note.id}
                onClick={() => onSelectNote(note)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors hover:bg-gray-100 text-gray-700"
              >
                <FileText className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                <span className="truncate">{note.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1">
        <h4 className="text-xs mb-2 text-gray-500">
          反向链接 ({backlinks.length})
        </h4>
        {backlinks.length > 0 ? (
          <div className="space-y-0.5">
            {backlinks.map(note => (
              <button
                key={note.id}
                onClick={() => onSelectNote(note)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors hover:bg-gray-100 text-gray-700"
              >
                <Link2 className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                <span className="truncate">{note.title}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            暂无反向链接
          </p>
        )}
      </div>
    </div>
  );
};
