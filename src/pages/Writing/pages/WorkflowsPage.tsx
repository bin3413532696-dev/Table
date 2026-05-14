import React, { useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Circle, Loader2, Timer } from 'lucide-react';
import { Card } from '../../../components/ui';
import { useWritingProject } from '../context';
import { workflowMeta } from '../mock';
import type { WritingProjectOutletContext } from '../types';

type WorkflowKey = 'bootstrap_bible' | 'consistency_check' | 'finalize_bible';

function getStageIcon(status: 'done' | 'current' | 'todo') {
  if (status === 'done') return <CheckCircle2 size={16} className="text-emerald-500" />;
  if (status === 'current') return <Loader2 size={16} className="animate-spin text-primary" />;
  return <Circle size={16} className="text-border-secondary" />;
}

function getWorkflowStatusConfig(status: 'running' | 'waiting_review' | 'completed') {
  const map = {
    running: { label: '运行中', bg: 'bg-sky-50 dark:bg-sky-950/30', text: 'text-sky-700 dark:text-sky-300', dot: 'bg-sky-500', border: 'border-sky-200 dark:border-sky-800' },
    waiting_review: { label: '等待确认', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500', border: 'border-amber-200 dark:border-amber-800' },
    completed: { label: '已完成', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-800' },
  };
  return map[status];
}

// 全局概览 - 串联三个工作流
function WorkflowGlobalBar({ project, activeKey, onSelect }: WritingProjectOutletContext & { activeKey: WorkflowKey; onSelect: (k: WorkflowKey) => void }) {
  const order: WorkflowKey[] = ['bootstrap_bible', 'consistency_check', 'finalize_bible'];

  return (
    <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
      <div className="mb-4 text-base font-semibold text-text-primary">工作流全局</div>
      <div className="flex items-center">
        {order.map((wfKey, idx) => {
          const wf = project.workflows[wfKey];
          const meta = workflowMeta.find((m) => m.id === wfKey)!;
          const cfg = getWorkflowStatusConfig(wf.status);
          const isActive = wfKey === activeKey;

          return (
            <React.Fragment key={wfKey}>
              <button
                type="button"
                onClick={() => onSelect(wfKey)}
                className={`group flex flex-col rounded-xl border p-4 transition-all ${
                  isActive
                    ? `${cfg.border} bg-bg-secondary ring-2 ring-primary/20`
                    : 'border-border-primary bg-bg-secondary hover:border-primary/30 hover:bg-bg-tertiary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{meta.label}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                  </span>
                </div>
                <div className="mt-2 text-xs text-text-muted">{wf.stage}</div>
                {wf.reviewQueue.length > 0 && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-warning">
                    <Activity size={11} />
                    <span>{wf.reviewQueue.length} 条待审核</span>
                  </div>
                )}
              </button>

              {idx < order.length - 1 && (
                <div className="mx-2 flex flex-col items-center">
                  <div className={`h-1 w-6 rounded-full ${
                    wf.status === 'completed' ? 'bg-emerald-500' : 'bg-border-primary'
                  }`} />
                  <span className="mt-1 text-xs text-text-muted">-&gt;</span>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Card>
  );
}

// 流水线节点 - 带悬停和 current 脉冲
function PipelineView({ project, activeKey }: WritingProjectOutletContext & { activeKey: WorkflowKey }) {
  const wf = project.workflows[activeKey];
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);
  const [expandedReview, setExpandedReview] = useState<string | null>(null);

  return (
    <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">{workflowMeta.find((m) => m.id === activeKey)?.label}</h2>
          <p className="mt-1 text-sm text-text-secondary">{wf.focus}</p>
        </div>
        {(() => {
          const cfg = getWorkflowStatusConfig(wf.status);
          return (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cfg.bg} ${cfg.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
          );
        })()}
      </div>

      {/* 节点流水线 */}
      <div className="mt-6 flex items-center gap-3 overflow-x-auto pb-4">
        {wf.stages.map((stage, index) => {
          const isHovered = hoveredStage === stage.id;
          const hasReview = stage.status === 'current' && wf.reviewQueue.length > 0;
          const isExpanded = expandedReview === stage.id;

          return (
            <React.Fragment key={stage.id}>
              <div
                className="relative flex flex-col items-center"
                onMouseEnter={() => setHoveredStage(stage.id)}
                onMouseLeave={() => setHoveredStage(null)}
              >
                {/* 节点主体 */}
                <div className={`relative flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all ${
                  stage.status === 'done'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                    : stage.status === 'current'
                      ? 'border-primary bg-primary/10 ring-4 ring-primary/20'
                      : 'border-border-primary bg-bg-secondary'
                } ${stage.status === 'current' ? 'animate-pulse' : ''}`}>
                  {getStageIcon(stage.status)}
                  {hasReview && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-white">
                      {wf.reviewQueue.length}
                    </span>
                  )}
                </div>

                {/* 悬停提示 */}
                {isHovered && (
                  <div className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border-primary bg-bg-card px-3 py-2 text-xs shadow-lg">
                    <div className="font-medium text-text-primary">{stage.label}</div>
                    <div className="mt-1 text-text-secondary">{stage.detail}</div>
                  </div>
                )}

                <div className="mt-3 max-w-[110px] text-center">
                  <div className="text-xs font-medium text-text-primary">{stage.label}</div>
                  {stage.status === 'current' && hasReview && (
                    <button
                      type="button"
                      onClick={() => setExpandedReview(isExpanded ? null : stage.id)}
                      className="mt-1 flex items-center gap-1 text-xs text-warning hover:underline"
                    >
                      <AlertCircle size={10} />
                      <span>{wf.reviewQueue.length} 条待审</span>
                      {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    </button>
                  )}
                </div>

                {/* 内联审核列表 */}
                {isExpanded && hasReview && (
                  <div className="absolute bottom-full left-1/2 z-20 mt-2 w-64 -translate-x-1/2 rounded-xl border border-warning/30 bg-bg-card p-3 shadow-xl">
                    <div className="mb-2 text-xs font-medium text-warning">待审核项</div>
                    {wf.reviewQueue.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border-primary bg-bg-secondary p-2">
                        <div className="text-xs font-medium text-text-primary">{item.title}</div>
                        <div className="mt-1 text-[10px] text-text-muted">{item.target}</div>
                        <div className="mt-1 text-xs leading-relaxed text-text-secondary">{item.summary}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {index < wf.stages.length - 1 && (
                <div className="mb-6 h-px flex-1 bg-gradient-to-r from-border-primary to-transparent" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Card>
  );
}

// 执行日志 - 可折叠
function ExecutionLog({ project, activeKey }: WritingProjectOutletContext & { activeKey: WorkflowKey }) {
  const [expanded, setExpanded] = useState(false);
  const wf = project.workflows[activeKey];
  const visibleEvents = expanded ? wf.events : wf.events.slice(0, 3);
  const hasMore = wf.events.length > 3;

  return (
    <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer size={16} className="text-text-secondary" />
          <div className="text-lg font-semibold text-text-primary">执行轨迹</div>
          <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-xs text-text-muted">{wf.events.length} 条</span>
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {expanded ? (
              <><ChevronUp size={12} /> 收起</>
            ) : (
              <><ChevronDown size={12} /> 展开全部</>
            )}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {visibleEvents.map((event) => (
          <div key={event.id} className="flex items-start gap-3 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border-primary hover:bg-bg-secondary">
            <div className={`mt-1 h-2 w-2 rounded-full ${
              event.tone === 'success' ? 'bg-emerald-500' :
              event.tone === 'warning' ? 'bg-amber-500' : 'bg-sky-500'
            }`} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-text-muted">{event.time}</span>
                <span className="text-sm text-text-secondary">{event.text}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function WorkflowsPage() {
  const { project } = useWritingProject() as WritingProjectOutletContext;
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowKey>('consistency_check');

  return (
    <div className="space-y-5">
      <WorkflowGlobalBar project={project} activeKey={activeWorkflow} onSelect={setActiveWorkflow} />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <PipelineView project={project} activeKey={activeWorkflow} />
          <ExecutionLog project={project} activeKey={activeWorkflow} />
        </div>

        {/* 右侧边栏 - 工作流信息 */}
        <div className="space-y-5">
          <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Activity size={16} className="text-text-secondary" />
              <div className="text-base font-semibold text-text-primary">工作流详情</div>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-border-primary bg-bg-secondary p-3">
                <div className="text-xs text-text-muted">当前节点</div>
                <div className="mt-1 text-sm font-medium text-text-primary">
                  {project.workflows[activeWorkflow].stage}
                </div>
              </div>
              <div className="rounded-lg border border-border-primary bg-bg-secondary p-3">
                <div className="text-xs text-text-muted">审核队列</div>
                <div className="mt-1 text-sm font-medium text-text-primary">
                  {project.workflows[activeWorkflow].reviewQueue.length} 条待处理
                </div>
              </div>
              <div className="rounded-lg border border-border-primary bg-bg-secondary p-3">
                <div className="text-xs text-text-muted">完成进度</div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${(project.workflows[activeWorkflow].stages.filter((s) => s.status === 'done').length / project.workflows[activeWorkflow].stages.length) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-text-muted">
                    {project.workflows[activeWorkflow].stages.filter((s) => s.status === 'done').length}/{project.workflows[activeWorkflow].stages.length}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* 最近的审核项 */}
          {project.workflows[activeWorkflow].reviewQueue.length > 0 && (
            <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <AlertCircle size={16} className="text-warning" />
                <div className="text-base font-semibold text-text-primary">待审核项</div>
              </div>
              <div className="space-y-3">
                {project.workflows[activeWorkflow].reviewQueue.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border-primary bg-bg-secondary p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-text-primary">{item.title}</div>
                      <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-xs text-warning">
                        候选
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-text-muted">目标: {item.target}</div>
                    <div className="mt-2 text-sm leading-relaxed text-text-secondary">{item.summary}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}