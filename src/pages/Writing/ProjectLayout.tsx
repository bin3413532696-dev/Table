import React from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { AlertTriangle, BookOpen, PenSquare } from 'lucide-react';
import { Card } from '../../components/ui';
import ProjectNav from './components/ProjectNav';
import { getWritingProject } from './mock';
import type { WritingProjectOutletContext } from './types';

export default function WritingProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = projectId ? getWritingProject(projectId) : null;

  if (!project) {
    return <Navigate to="/writing" replace />;
  }

  const context: WritingProjectOutletContext = { project };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary">
      <div className="mb-5">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <PenSquare size={15} />
          <span>Writing</span>
          <span>/</span>
          <span>{project.title}</span>
        </div>
        <div className="mt-3 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h1 className="page-header-title">{project.title}</h1>
                <p className="mt-2 text-sm text-text-muted">
                  {project.genre} · {project.subGenre} · {project.worldType}
                </p>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-text-secondary">
                  {project.premise}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-xl border border-border-primary bg-bg-secondary p-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-text-muted">Canon</div>
                  <div className="mt-2 font-semibold text-text-primary">{project.metrics.confirmed}</div>
                </div>
                <div className="rounded-xl border border-border-primary bg-bg-secondary p-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-text-muted">冲突</div>
                  <div className="mt-2 font-semibold text-text-primary">{project.metrics.openConflicts}</div>
                </div>
                <div className="rounded-xl border border-border-primary bg-bg-secondary p-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-text-muted">圣经</div>
                  <div className="mt-2 font-semibold text-text-primary">{project.bibleVersion}</div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                <BookOpen size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary">Story Compass</div>
                <div className="mt-1 text-sm leading-7 text-text-secondary">
                  {project.storyCompass.promise}
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
                  <AlertTriangle size={13} />
                  <span>{project.metrics.candidates} 条候选修订待你确认</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <ProjectNav projectId={project.id} />

      <div className="mt-5">
        <Outlet context={context} />
      </div>
    </div>
  );
}
