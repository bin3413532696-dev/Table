import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, Library, PenSquare, Sparkles } from 'lucide-react';
import { Button, Card } from '../../components/ui';
import MetricStrip from './components/MetricStrip';
import { getRecentWritingProject, writingProjects } from './mock';

export default function WritingHome() {
  const recentProject = getRecentWritingProject();

  const totals = useMemo(() => {
    const projectCount = writingProjects.length;
    const activeCount = writingProjects.filter((item) => item.status === 'active').length;
    const candidateCount = writingProjects.reduce((sum, item) => sum + item.metrics.candidates, 0);
    const conflictCount = writingProjects.reduce((sum, item) => sum + item.metrics.openConflicts, 0);

    return {
      projectCount,
      activeCount,
      candidateCount,
      conflictCount,
    };
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary">
      <div className="mb-6 md:mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="page-header mb-0">
          <div className="page-header-icon">
            <PenSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="page-header-title">写作项目</h1>
            <p className="page-header-subtitle">
              先管理项目，再进入每部作品的设定库、审校、圣经和工作流页面。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<Library size={15} />}
            onClick={() => undefined}
          >
            导入项目
          </Button>
          <Button icon={<Sparkles size={15} />} onClick={() => undefined}>
            新建作品
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden rounded-[14px] border border-border-primary bg-bg-card p-0 shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="border-b border-border-primary p-6 lg:border-b-0 lg:border-r">
              <div className="text-xs uppercase tracking-[0.16em] text-text-muted">
                Continue Writing
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-text-primary">
                {recentProject.title}
              </h2>
              <div className="mt-2 text-sm text-text-muted">
                {recentProject.genre} · {recentProject.subGenre} · {recentProject.updatedAt}
              </div>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-text-secondary">
                {recentProject.premise}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to={`/writing/projects/${recentProject.id}`}>
                  <Button icon={<ChevronRight size={15} />}>继续创作</Button>
                </Link>
                <Link to={`/writing/projects/${recentProject.id}/canon`}>
                  <Button variant="secondary" icon={<BookOpen size={15} />}>
                    打开设定库
                  </Button>
                </Link>
              </div>
            </div>

            <div className="p-6">
              <div className="text-sm font-medium text-text-primary">最近作品摘要</div>
              <div className="mt-4 space-y-3">
                {[
                  ['作品承诺', recentProject.storyCompass.promise],
                  ['世界压力', recentProject.storyCompass.worldPressure],
                  ['当前版本', `作品圣经 ${recentProject.bibleVersion}`],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-border-primary bg-bg-secondary p-4"
                  >
                    <div className="text-xs uppercase tracking-[0.14em] text-text-muted">
                      {label}
                    </div>
                    <div className="mt-2 text-sm leading-7 text-text-secondary">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
          <div className="text-base font-semibold text-text-primary">写作队列</div>
          <div className="mt-4 space-y-3">
            {writingProjects.map((project) => (
              <Link
                key={project.id}
                to={`/writing/projects/${project.id}/review`}
                className="block rounded-xl border border-border-primary bg-bg-secondary p-4 transition-all hover:border-border-secondary hover:bg-bg-tertiary"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-text-primary">{project.title}</div>
                    <div className="mt-1 text-xs text-text-muted">
                      {project.metrics.candidates} 条候选修订 · {project.metrics.openConflicts} 条冲突
                    </div>
                  </div>
                  <span className="rounded-full border border-warning/20 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                    待处理
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <MetricStrip
          items={[
            { label: '作品总数', value: totals.projectCount, helper: '当前 mock 项目集合' },
            { label: '进行中', value: totals.activeCount, helper: '正在持续维护的作品' },
            { label: '候选修订', value: totals.candidateCount, helper: '等待人工确认的修改' },
            { label: '未处理冲突', value: totals.conflictCount, helper: '建议优先清理高风险项' },
          ]}
        />
      </div>

      <div className="mt-8">
        <div className="mb-4">
          <h2 className="section-title">作品列表</h2>
          <p className="mt-1 text-sm text-text-muted">
            先看项目，再进入该作品的阶段页面。
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {writingProjects.map((project) => (
            <Card
              key={project.id}
              className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-text-primary">{project.title}</h3>
                  <p className="mt-1 text-sm text-text-muted">
                    {project.genre} · {project.subGenre}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  project.status === 'active'
                    ? 'bg-success/10 text-success'
                    : 'bg-bg-secondary text-text-secondary'
                }`}>
                  {project.status === 'active' ? '进行中' : '草稿'}
                </span>
              </div>

              <p className="mt-4 text-sm leading-7 text-text-secondary">
                {project.premise}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-border-primary bg-bg-secondary p-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-text-muted">Canon</div>
                  <div className="mt-2 font-medium text-text-primary">{project.metrics.confirmed}</div>
                </div>
                <div className="rounded-xl border border-border-primary bg-bg-secondary p-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-text-muted">圣经版本</div>
                  <div className="mt-2 font-medium text-text-primary">{project.bibleVersion}</div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link to={`/writing/projects/${project.id}`}>
                  <Button size="sm">作品总览</Button>
                </Link>
                <Link to={`/writing/projects/${project.id}/canon`}>
                  <Button variant="secondary" size="sm">设定库</Button>
                </Link>
                <Link to={`/writing/projects/${project.id}/workflows`}>
                  <Button variant="ghost" size="sm">工作流</Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
