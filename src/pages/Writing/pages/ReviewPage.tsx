import React, { useMemo, useState } from 'react';
import { Filter } from 'lucide-react';
import { Card } from '../../../components/ui';
import { ConflictSeverityPill } from '../components/StatusPills';
import { useWritingProject } from '../context';
import type { WritingConflictItem, WritingConflictSeverity } from '../types';

type FilterType = 'all' | WritingConflictSeverity;

export default function ReviewPage() {
  const { project } = useWritingProject();
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedId, setSelectedId] = useState<string>(project.conflicts[0]?.id || '');

  const conflicts = useMemo(() => {
    if (filter === 'all') return project.conflicts;
    return project.conflicts.filter((item) => item.severity === filter);
  }, [filter, project.conflicts]);

  const selected =
    conflicts.find((item) => item.id === selectedId) ||
    project.conflicts.find((item) => item.id === selectedId) ||
    conflicts[0];

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
          <div className="flex items-center gap-3">
            <Filter size={18} className="text-text-secondary" />
            <div className="text-lg font-semibold text-text-primary">冲突筛选</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(['all', 'critical', 'high', 'medium', 'low'] as FilterType[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
                  filter === item
                    ? 'bg-primary text-white'
                    : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
                }`}
              >
                {item === 'all' ? '全部' : item}
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          {conflicts.map((item) => (
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
                <div className="text-sm font-medium text-text-primary">{item.title}</div>
                <ConflictSeverityPill severity={item.severity} />
              </div>
              <div className="mt-2 text-xs text-text-muted">{item.category}</div>
              <div className="mt-3 text-sm leading-7 text-text-secondary">{item.summary}</div>
            </button>
          ))}
        </div>
      </div>

      <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ConflictSeverityPill severity={selected.severity} />
              <span className="rounded-full border border-border-primary bg-bg-secondary px-2.5 py-1 text-xs font-medium text-text-secondary">
                {selected.category}
              </span>
              <span className="rounded-full border border-border-primary bg-bg-secondary px-2.5 py-1 text-xs font-medium text-text-secondary">
                {selected.status === 'open' ? '待处理' : selected.status === 'ignored' ? '已忽略' : '已解决'}
              </span>
            </div>

            <h2 className="mt-4 text-2xl font-semibold text-text-primary">{selected.title}</h2>
            <p className="mt-4 text-sm leading-7 text-text-secondary">{selected.summary}</p>

            <div className="mt-6 rounded-xl border border-warning/20 bg-warning/10 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-warning">修订建议</div>
              <div className="mt-2 text-sm leading-7 text-text-primary">{selected.suggestion}</div>
            </div>

            <div className="mt-6">
              <div className="text-xs uppercase tracking-[0.14em] text-text-muted">关联资产</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.involvedAssets.map((asset) => (
                  <span
                    key={asset}
                    className="rounded-full border border-border-primary bg-bg-secondary px-3 py-1 text-xs font-medium text-text-secondary"
                  >
                    {asset}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-text-muted">没有匹配当前筛选条件的冲突。</div>
        )}
      </Card>
    </div>
  );
}
