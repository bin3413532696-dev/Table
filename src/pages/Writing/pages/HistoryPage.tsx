import React from 'react';
import { Card } from '../../../components/ui';
import { useWritingProject } from '../context';

export default function HistoryPage() {
  const { project } = useWritingProject();

  return (
    <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
      <div className="text-lg font-semibold text-text-primary">历史记录</div>
      <div className="mt-5 space-y-4">
        {project.history.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-border-primary bg-bg-secondary p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-text-primary">{item.title}</div>
                <div className="mt-1 text-xs text-text-muted">
                  {item.actor} · {item.time}
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                item.tone === 'success'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : item.tone === 'warning'
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300'
              }`}>
                {item.type}
              </span>
            </div>
            <div className="mt-3 text-sm leading-7 text-text-secondary">{item.summary}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
