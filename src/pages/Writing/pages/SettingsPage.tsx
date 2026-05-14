import React from 'react';
import { Card } from '../../../components/ui';
import { useWritingProject } from '../context';

export default function SettingsPage() {
  const { project } = useWritingProject();

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {[
        ['禁写项', project.settings.forbiddenTerms],
        ['风格约束', project.settings.styleConstraints],
        ['边界规则', project.settings.boundaryRules],
      ].map(([label, items]) => (
        <Card
          key={String(label)}
          className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm"
        >
          <div className="text-lg font-semibold text-text-primary">{label}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(items as string[]).map((item) => (
              <span
                key={item}
                className="rounded-full border border-border-primary bg-bg-secondary px-3 py-1 text-xs font-medium text-text-secondary"
              >
                {item}
              </span>
            ))}
          </div>
        </Card>
      ))}

      <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
        <div className="text-lg font-semibold text-text-primary">模型配置</div>
        <div className="mt-4 text-sm leading-7 text-text-secondary">
          {project.settings.modelProfile}
        </div>
      </Card>

      <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm xl:col-span-2">
        <div className="text-lg font-semibold text-text-primary">工作流说明</div>
        <div className="mt-4 text-sm leading-7 text-text-secondary">
          {project.settings.workflowNotes}
        </div>
      </Card>
    </div>
  );
}
