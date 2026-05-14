import React from 'react';

export interface MetricItem {
  label: string;
  value: string | number;
  helper: string;
}

export default function MetricStrip({ items }: { items: MetricItem[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="stat-card">
          <div className="text-xs uppercase tracking-[0.16em] text-text-muted">{item.label}</div>
          <div className="stat-card-value mt-3 text-text-primary">{item.value}</div>
          <div className="stat-card-label mt-2">{item.helper}</div>
        </div>
      ))}
    </div>
  );
}
