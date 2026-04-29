import React, { useMemo } from 'react';
import { GraphNode, GraphLink } from './types';

interface GraphControlsProps {
  zoom: number;
  showLabels: boolean;
  filterMode: 'all' | 'connected' | 'local';
  canUseLocalFilter: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onToggleLabels: () => void;
  onFilterChange: (mode: 'all' | 'connected' | 'local') => void;
}

export const GraphControls: React.FC<GraphControlsProps> = ({
  zoom,
  showLabels,
  filterMode,
  canUseLocalFilter,
  onZoomIn,
  onZoomOut,
  onReset,
  onToggleLabels,
  onFilterChange
}) => {
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          知识图谱
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleLabels}
            className={`p-1 rounded transition-colors ${showLabels ? 'bg-bg-tertiary text-text-primary' : 'text-text-muted hover:bg-bg-tertiary'}`}
            title={showLabels ? '隐藏标签' : '显示标签'}
          >
            <span className="text-xs font-medium">Aa</span>
          </button>
          <div className="w-px h-4 bg-border-primary mx-1" />
          <button
            onClick={onZoomOut}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted transition-colors"
            title="缩小"
          >
            <span className="text-xs">−</span>
          </button>
          <span className="text-xs text-text-muted w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={onZoomIn}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted transition-colors"
            title="放大"
          >
            <span className="text-xs">+</span>
          </button>
          <button
            onClick={onReset}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted transition-colors"
            title="重置视图"
          >
            <span className="text-xs">↺</span>
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-2">
        {(['all', 'connected', 'local'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => onFilterChange(mode)}
            disabled={mode === 'local' && !canUseLocalFilter}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              filterMode === mode
                ? 'bg-primary text-white'
                : 'bg-bg-tertiary text-text-muted hover:bg-bg-secondary'
            } ${mode === 'local' && !canUseLocalFilter ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {mode === 'all' ? '全部' : mode === 'connected' ? '已连接' : '局部'}
          </button>
        ))}
      </div>
    </>
  );
};

interface GraphStatsProps {
  nodeCount: number;
  linkCount: number;
  isolatedCount: number;
  filterMode: 'all' | 'connected' | 'local';
}

export const GraphStats: React.FC<GraphStatsProps> = ({
  nodeCount,
  linkCount,
  isolatedCount,
  filterMode
}) => {
  return (
    <div className="absolute bottom-2 left-2 text-xs text-text-muted bg-bg-card/90 backdrop-blur-sm px-2 py-1 rounded shadow-sm">
      {nodeCount} 笔记 · {linkCount} 连接
      {isolatedCount > 0 && filterMode === 'all' && (
        <span className="text-amber-500 dark:text-amber-400 ml-1">({isolatedCount} 孤立)</span>
      )}
    </div>
  );
};

interface NodeTooltipProps {
  node: GraphNode;
}

export const NodeTooltip: React.FC<NodeTooltipProps> = ({ node }) => {
  return (
    <div className="absolute top-2 right-2 text-xs bg-bg-card/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-lg border border-border-primary">
      <div className="font-medium text-text-primary mb-1">{node.title}</div>
      <div className="text-text-muted">
        出链: {node.outLinks} · 入链: {node.inLinks}
      </div>
      {node.tags.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {node.tags.slice(0, 3).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 bg-bg-tertiary rounded text-text-muted">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
