import React from 'react';
import type {
  WritingAssetStatus,
  WritingConflictSeverity,
  WritingWorkflowStatus,
} from '../types';

export function AssetStatusPill({ status }: { status: WritingAssetStatus }) {
  const label =
    status === 'confirmed' ? '已确认' : status === 'candidate' ? '候选' : '草稿';
  const className =
    status === 'confirmed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-300'
      : status === 'candidate'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/30 dark:text-amber-300'
        : 'border-border-primary bg-bg-secondary text-text-secondary';

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

export function WorkflowStatusPill({ status }: { status: WritingWorkflowStatus }) {
  const label =
    status === 'completed' ? '已完成' : status === 'waiting_review' ? '等待确认' : '运行中';
  const className =
    status === 'completed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-300'
      : status === 'waiting_review'
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/30 dark:text-amber-300'
        : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/30 dark:bg-sky-950/30 dark:text-sky-300';

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

export function ConflictSeverityPill({ severity }: { severity: WritingConflictSeverity }) {
  const className =
    severity === 'critical'
      ? 'bg-red-600 text-white'
      : severity === 'high'
        ? 'border border-red-200 bg-red-50 text-red-700 dark:border-red-900/30 dark:bg-red-950/30 dark:text-red-300'
        : severity === 'medium'
          ? 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/30 dark:text-amber-300'
          : 'border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300';

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {severity}
    </span>
  );
}
