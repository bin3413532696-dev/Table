import React from 'react';
import { BookOpen, Clock3, Compass, Shield, Sparkles } from 'lucide-react';
import { Card } from '../../../components/ui';
import MetricStrip from '../components/MetricStrip';
import { useWritingProject } from '../context';

export default function OverviewPage() {
  const { project } = useWritingProject();

  return (
    <div className="space-y-5">
      <MetricStrip
        items={[
          { label: '正式资产', value: project.metrics.confirmed, helper: '已确认可作为写作真相源' },
          { label: '候选修订', value: project.metrics.candidates, helper: '等待人工确认的变化' },
          { label: '未处理冲突', value: project.metrics.openConflicts, helper: '建议先处理 critical / high' },
          { label: '圣经覆盖', value: `${project.metrics.bibleCoverage}%`, helper: '当前正式版覆盖度' },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
          <div className="flex items-center gap-3">
            <Compass size={18} className="text-text-secondary" />
            <div className="text-lg font-semibold text-text-primary">Story Compass</div>
          </div>
          <div className="mt-5 grid gap-4">
            {[
              ['作品承诺', project.storyCompass.promise],
              ['主角需求', project.storyCompass.protagonistNeed],
              ['世界压力', project.storyCompass.worldPressure],
              ['语气基调', project.storyCompass.tone],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-border-primary bg-bg-secondary p-4"
              >
                <div className="text-xs uppercase tracking-[0.14em] text-text-muted">{label}</div>
                <div className="mt-3 text-sm leading-7 text-text-secondary">{value}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
            <div className="flex items-center gap-3">
              <Shield size={18} className="text-text-secondary" />
              <div className="text-lg font-semibold text-text-primary">作者意图</div>
            </div>
            <div className="mt-4 space-y-3">
              {project.storyCompass.intent.map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-border-primary bg-bg-secondary p-4 text-sm leading-7 text-text-secondary"
                >
                  {item}
                </div>
              ))}
            </div>
          </Card>

          <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
            <div className="flex items-center gap-3">
              <Clock3 size={18} className="text-text-secondary" />
              <div className="text-lg font-semibold text-text-primary">近期动态</div>
            </div>
            <div className="mt-4 space-y-3">
              {project.history.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-border-primary bg-bg-secondary p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-text-primary">{item.title}</div>
                    <span className="text-xs text-text-muted">{item.time}</span>
                  </div>
                  <div className="mt-2 text-sm leading-7 text-text-secondary">{item.summary}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {[
          {
            title: '设定库',
            icon: BookOpen,
            content: `角色 ${project.assets.characters.length} / 势力 ${project.assets.factions.length} / 地点 ${project.assets.locations.length}`,
          },
          {
            title: '冲突审校',
            icon: Sparkles,
            content: `当前有 ${project.metrics.openConflicts} 条冲突待处理，${project.metrics.candidates} 条候选修订待确认。`,
          },
          {
            title: '作品圣经',
            icon: Compass,
            content: `当前正式版 ${project.bibleVersion}，最近候选版 ${project.bibles.find((item) => item.status === 'candidate')?.version || '无'}`,
          },
        ].map((item) => (
          <Card
            key={item.title}
            className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm"
          >
            <div className="flex items-center gap-3">
              <item.icon size={18} className="text-text-secondary" />
              <div className="text-lg font-semibold text-text-primary">{item.title}</div>
            </div>
            <div className="mt-4 text-sm leading-7 text-text-secondary">{item.content}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
