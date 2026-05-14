import React, { useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { Card } from '../../../components/ui';
import { useWritingProject } from '../context';

export default function BiblePage() {
  const { project } = useWritingProject();
  const [selectedId, setSelectedId] = useState(project.bibles[0]?.id || '');
  const selected = project.bibles.find((item) => item.id === selectedId) || project.bibles[0];

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-3">
        {project.bibles.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelectedId(item.id)}
            className={`w-full rounded-xl border p-4 text-left transition-all ${
              selected?.id === item.id
                ? 'border-primary/30 bg-primary/10'
                : 'border-border-primary bg-bg-card hover:bg-bg-secondary'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-text-primary">{item.version}</div>
                <div className="mt-1 text-xs text-text-muted">
                  {item.status === 'published' ? '正式版' : '候选版'}
                </div>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                item.status === 'published'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/30 dark:text-amber-300'
              }`}>
                {item.status === 'published' ? '发布中' : '待确认'}
              </span>
            </div>
            <div className="mt-3 text-sm leading-7 text-text-secondary">{item.summary}</div>
          </button>
        ))}
      </div>

      <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
        {selected ? (
          <>
            <div className="flex items-center gap-3">
              <BookOpenText size={18} className="text-text-secondary" />
              <div>
                <h2 className="text-2xl font-semibold text-text-primary">{selected.version}</h2>
                <div className="mt-1 text-sm text-text-secondary">
                  {selected.status === 'published' ? '当前正式版作品圣经' : '候选版作品圣经'}
                </div>
              </div>
            </div>
            <p className="mt-5 text-sm leading-7 text-text-secondary">{selected.summary}</p>
            <div className="mt-6">
              <div className="text-xs uppercase tracking-[0.14em] text-text-muted">核心支柱</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.pillars.map((pillar) => (
                  <span
                    key={pillar}
                    className="rounded-full border border-border-primary bg-bg-secondary px-3 py-1 text-xs font-medium text-text-secondary"
                  >
                    {pillar}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {selected.excerpt.map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-border-primary bg-bg-secondary p-4 text-sm leading-7 text-text-secondary"
                >
                  {item}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Card>
    </div>
  );
}
