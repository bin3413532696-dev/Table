import React from 'react';
import { Card } from '../../../components/ui';

export default function NotImplementedPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="rounded-[14px] border border-dashed border-border-primary bg-bg-card shadow-sm">
      <div className="text-lg font-semibold text-text-primary">{title}</div>
      <div className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary">
        {description}
      </div>
    </Card>
  );
}
