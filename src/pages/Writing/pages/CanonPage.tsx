import React, { useEffect, useMemo, useState } from 'react';
import { LibraryBig } from 'lucide-react';
import { Card } from '../../../components/ui';
import { AssetStatusPill } from '../components/StatusPills';
import { canonSectionMeta } from '../mock';
import { useWritingProject } from '../context';
import type { WritingAssetRecord, WritingCanonSection } from '../types';

export default function CanonPage() {
  const { project } = useWritingProject();
  const [activeSection, setActiveSection] = useState<WritingCanonSection>('characters');
  const currentItems = project.assets[activeSection];
  const [selectedId, setSelectedId] = useState<string | null>(currentItems[0]?.id || null);

  useEffect(() => {
    setSelectedId(project.assets[activeSection][0]?.id || null);
  }, [activeSection, project]);

  const selectedItem = useMemo<WritingAssetRecord | undefined>(
    () => currentItems.find((item) => item.id === selectedId) || currentItems[0],
    [currentItems, selectedId]
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
          <div className="flex items-center gap-3">
            <LibraryBig size={18} className="text-text-secondary" />
            <div>
              <div className="text-lg font-semibold text-text-primary">设定库</div>
              <div className="mt-1 text-sm text-text-secondary">聚合页 + 详情面板</div>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {canonSectionMeta.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  activeSection === section.id
                    ? 'border-primary/30 bg-primary/10'
                    : 'border-border-primary bg-bg-secondary hover:bg-bg-tertiary'
                }`}
              >
                <div className="text-sm font-medium text-text-primary">{section.label}</div>
                <div className="mt-1 text-xs text-text-muted">{section.helper}</div>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-3">
          {currentItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`w-full rounded-xl border p-4 text-left transition-all ${
                selectedId === item.id
                  ? 'border-primary/30 bg-primary/10'
                  : 'border-border-primary bg-bg-card hover:bg-bg-secondary'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-text-primary">{item.title}</div>
                  <div className="mt-1 text-xs text-text-muted">{item.subtitle}</div>
                </div>
                <AssetStatusPill status={item.status} />
              </div>
              <div className="mt-3 text-sm leading-7 text-text-secondary">{item.summary}</div>
            </button>
          ))}
        </div>
      </div>

      <Card className="rounded-[14px] border border-border-primary bg-bg-card shadow-sm">
        {selectedItem ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold text-text-primary">{selectedItem.title}</h2>
                <div className="mt-2 text-sm text-text-secondary">{selectedItem.subtitle}</div>
              </div>
              <AssetStatusPill status={selectedItem.status} />
            </div>

            <p className="mt-5 text-sm leading-7 text-text-secondary">{selectedItem.summary}</p>

            {selectedItem.tags && selectedItem.tags.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {selectedItem.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border-primary bg-bg-secondary px-3 py-1 text-xs font-medium text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-6 grid gap-4">
              {selectedItem.sections.map((section) => (
                <div
                  key={section.label}
                  className="rounded-xl border border-border-primary bg-bg-secondary p-4"
                >
                  <div className="text-xs uppercase tracking-[0.14em] text-text-muted">{section.label}</div>
                  {Array.isArray(section.value) ? (
                    <div className="mt-3 space-y-2">
                      {section.value.map((entry) => (
                        <div key={entry} className="text-sm leading-7 text-text-secondary">
                          {entry}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-sm leading-7 text-text-secondary">{section.value}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-sm text-text-muted">当前分组暂无资产。</div>
        )}
      </Card>
    </div>
  );
}
