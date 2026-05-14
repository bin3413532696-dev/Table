import React from 'react';
import { NavLink } from 'react-router-dom';
import { projectNavItems } from '../mock';

export default function ProjectNav({ projectId }: { projectId: string }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="flex min-w-max gap-2 rounded-xl border border-border-primary bg-bg-card p-2 shadow-sm">
        {projectNavItems.map((item) => {
          const to = item.path
            ? `/writing/projects/${projectId}/${item.path}`
            : `/writing/projects/${projectId}`;

          return (
            <NavLink
              key={item.label}
              to={to}
              end={!item.path}
              className={({ isActive }) =>
                `rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
                }`
              }
            >
              {item.label}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
