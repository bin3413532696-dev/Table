import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { Share2 } from 'lucide-react';
import { Note } from '../../../db';
import { useTheme } from '../../../contexts/ThemeContext';
import { GraphNode, GraphLink, COLORS } from './GraphView/types';
import { GraphControls, GraphStats, NodeTooltip } from './GraphView/GraphControls';

interface GraphViewProps {
  notes: Note[];
  currentNote: Note | null;
  onSelectNote: (note: Note) => void;
}

type FilterMode = 'all' | 'connected' | 'local';

export const GraphView: React.FC<GraphViewProps> = ({
  notes,
  currentNote,
  onSelectNote
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const nodeSelectionRef = useRef<d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null);
  const linkSelectionRef = useRef<d3.Selection<SVGLineElement, GraphLink, SVGGElement, GraphLink> | null>(null);
  const onSelectNoteRef = useRef(onSelectNote);
  const { theme } = useTheme();

  const [zoom, setZoom] = useState(1);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [showLabels, setShowLabels] = useState(true);

  useEffect(() => {
    onSelectNoteRef.current = onSelectNote;
  }, [onSelectNote]);

  const { nodes, links, clusters, noteToCluster } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const linkList: GraphLink[] = [];
    const clusterMap = new Map<string, number>();
    let clusterIndex = 0;

    notes.forEach(note => {
      const outLinks = note.links?.length || 0;
      const inLinks = note.backlinks?.length || 0;
      const linkCount = outLinks + inLinks;

      nodeMap.set(note.id, {
        id: note.id,
        title: note.title,
        radius: Math.max(8, Math.min(28, 8 + Math.sqrt(linkCount) * 4)),
        linkCount,
        outLinks,
        inLinks,
        tags: note.tags || []
      });
    });

    const addedLinks = new Set<string>();
    notes.forEach(note => {
      (note.links || []).forEach(linkedNoteId => {
        if (nodeMap.has(linkedNoteId)) {
          const linkKey = [note.id, linkedNoteId].sort().join('-');
          if (!addedLinks.has(linkKey)) {
            linkList.push({
              source: note.id,
              target: linkedNoteId
            });
            addedLinks.add(linkKey);
          }
        }
      });
    });

    linkList.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;

      if (!clusterMap.has(sourceId) && !clusterMap.has(targetId)) {
        clusterMap.set(sourceId, clusterIndex);
        clusterMap.set(targetId, clusterIndex);
        clusterIndex++;
      } else if (clusterMap.has(sourceId) && !clusterMap.has(targetId)) {
        clusterMap.set(targetId, clusterMap.get(sourceId)!);
      } else if (!clusterMap.has(sourceId) && clusterMap.has(targetId)) {
        clusterMap.set(sourceId, clusterMap.get(targetId)!);
      }
    });

    const isolatedClusterStart = clusterIndex;
    nodeMap.forEach((node, id) => {
      if (!clusterMap.has(id)) {
        clusterMap.set(id, isolatedClusterStart + (clusterIndex - isolatedClusterStart));
        clusterIndex++;
      }
      node.cluster = clusterMap.get(id);
    });

    return {
      nodes: Array.from(nodeMap.values()),
      links: linkList,
      clusters: clusterIndex,
      noteToCluster: clusterMap
    };
  }, [notes]);

  const filteredData = useMemo(() => {
    if (filterMode === 'all') {
      return { nodes, links };
    }

    if (filterMode === 'connected') {
      const connectedIds = new Set<string>();
      links.forEach(link => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        connectedIds.add(sourceId);
        connectedIds.add(targetId);
      });

      const filteredNodes = nodes.filter(n => connectedIds.has(n.id));
      const filteredLinks = links.filter(link => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        return connectedIds.has(sourceId) && connectedIds.has(targetId);
      });

      return { nodes: filteredNodes, links: filteredLinks };
    }

    if (filterMode === 'local' && currentNote) {
      const localIds = new Set<string>([currentNote.id]);
      (currentNote.links || []).forEach(id => localIds.add(id));
      (currentNote.backlinks || []).forEach(id => localIds.add(id));

      const filteredNodes = nodes.filter(n => localIds.has(n.id));
      const filteredLinks = links.filter(link => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        return localIds.has(sourceId) && localIds.has(targetId);
      });

      return { nodes: filteredNodes, links: filteredLinks };
    }

    return { nodes, links };
  }, [nodes, links, filterMode, currentNote]);

  const handleZoom = useCallback((delta: number) => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3]);

    svg.transition().duration(300).call(
      zoomBehavior.transform as any,
      d3.zoomIdentity.scale(Math.max(0.3, Math.min(3, zoom + delta)))
    );
    setZoom(prev => Math.max(0.3, Math.min(3, prev + delta)));
  }, [zoom]);

  const handleReset = useCallback(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(500).call(
      d3.zoom<SVGSVGElement, unknown>().transform as any,
      d3.zoomIdentity
    );
    setZoom(1);
    if (simulationRef.current) {
      simulationRef.current.alpha(1).restart();
    }
  }, []);

  useEffect(() => {
    if (!svgRef.current || filteredData.nodes.length === 0) return;

    const isDark = theme === 'dark';
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = containerRef.current;
    const width = container?.clientWidth || 300;
    const height = container?.clientHeight || 300;

    const g = svg.append('g').attr('class', 'graph-container');

    const simulation = d3.forceSimulation<GraphNode>(filteredData.nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(filteredData.links)
        .id((d: GraphNode) => d.id)
        .distance(d => {
          const source = d.source as GraphNode;
          const target = d.target as GraphNode;
          return Math.max(50, (source.radius + target.radius) * 2);
        })
        .strength(0.5))
      .force('charge', d3.forceManyBody()
        .strength(-120)
        .distanceMax(250))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>()
        .radius((d: GraphNode) => d.radius + 8)
        .strength(0.8))
      .force('radial', d3.forceRadial<GraphNode>(
        (d: GraphNode) => d.linkCount === 0 ? Math.min(width, height) * 0.4 : 0,
        width / 2,
        height / 2
      ).strength(0.1));

    simulationRef.current = simulation;

    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(filteredData.links)
      .join<SVGLineElement>('line')
      .attr('stroke', isDark ? '#334155' : '#CBD5E1')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1);

    linkSelectionRef.current = link as d3.Selection<SVGLineElement, GraphLink, SVGGElement, GraphLink>;

    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(filteredData.nodes)
      .join('g')
      .attr('cursor', 'pointer');

    nodeSelectionRef.current = node;

    const linkSelection = link;
    const nodeSelection = node;

    node.append('circle')
      .attr('r', (d: GraphNode) => d.radius)
      .attr('fill', (d: GraphNode) => {
        if (d.linkCount === 0) return isDark ? '#1e293b' : '#E5E7EB';
        const clusterColor = COLORS.cluster[d.cluster! % COLORS.cluster.length];
        return isDark ? adjustColorForDark(clusterColor) : clusterColor;
      })
      .attr('stroke', (d: GraphNode) => {
        if (d.linkCount === 0) return isDark ? '#334155' : '#D1D5DB';
        const clusterColor = COLORS.cluster[d.cluster! % COLORS.cluster.length];
        return isDark ? clusterColor : adjustColorForLight(clusterColor);
      })
      .attr('stroke-width', 2)
      .attr('opacity', 0.9);

    if (showLabels) {
      node.append('text')
        .text((d: GraphNode) => d.title.length > 10 ? d.title.slice(0, 10) + '...' : d.title)
        .attr('text-anchor', 'middle')
        .attr('dy', (d: GraphNode) => d.radius + 14)
        .attr('font-size', '9px')
        .attr('font-weight', '500')
        .attr('fill', isDark ? '#94a3b8' : '#64748b')
        .attr('pointer-events', 'none');
    }

    node.call(d3.drag<SVGGElement, GraphNode>()
      .on('start', (event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>, d: GraphNode) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }));

    node.on('click', (event: MouseEvent, d: GraphNode) => {
      event.stopPropagation();
      const note = notes.find(n => n.id === d.id);
      if (note) onSelectNoteRef.current(note);
    });

    node.on('mouseenter', (event: MouseEvent, d: GraphNode) => {
      setHoveredNode(d);
      d3.select(event.currentTarget as SVGGElement).select('circle')
        .transition()
        .duration(150)
        .attr('stroke-width', 4)
        .attr('opacity', 1);

      link.attr('stroke-opacity', (l: GraphLink) => {
        const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
        const targetId = typeof l.target === 'string' ? l.target : l.target.id;
        return sourceId === d.id || targetId === d.id ? 0.8 : 0.1;
      });

      node.selectAll<SVGCircleElement, GraphNode>('circle').attr('opacity', (n) => {
        const isConnected = filteredData.links.some(l => {
          const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
          const targetId = typeof l.target === 'string' ? l.target : l.target.id;
          return (sourceId === d.id && targetId === n.id) || (targetId === d.id && sourceId === n.id);
        });
        return n.id === d.id || isConnected ? 1 : 0.3;
      });
    });

    node.on('mouseleave', () => {
      setHoveredNode(null);
      node.selectAll('circle')
        .transition()
        .duration(150)
        .attr('stroke-width', 2)
        .attr('opacity', 0.9);

      link.attr('stroke-opacity', 0.4);
    });

    simulation.on('tick', () => {
      link
        .attr('x1', (d: GraphLink) => {
          const source = d.source as GraphNode;
          return Math.max(10, Math.min(width - 10, source.x || 0));
        })
        .attr('y1', (d: GraphLink) => {
          const source = d.source as GraphNode;
          return Math.max(10, Math.min(height - 10, source.y || 0));
        })
        .attr('x2', (d: GraphLink) => {
          const target = d.target as GraphNode;
          return Math.max(10, Math.min(width - 10, target.x || 0));
        })
        .attr('y2', (d: GraphLink) => {
          const target = d.target as GraphNode;
          return Math.max(10, Math.min(height - 10, target.y || 0));
        });

      node.attr('transform', (d: GraphNode) => {
        const x = Math.max(d.radius + 5, Math.min(width - d.radius - 5, d.x || 0));
        const y = Math.max(d.radius + 5, Math.min(height - d.radius - 5, d.y || 0));
        return `translate(${x},${y})`;
      });
    });

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        setZoom(event.transform.k);
      });

    svg.call(zoomBehavior as any);

    return () => {
      simulation.stop();
      simulation.on('tick', null);

      if (nodeSelection) {
        nodeSelection.on('click', null);
        nodeSelection.on('mouseenter', null);
        nodeSelection.on('mouseleave', null);
      }

      svg.on('.zoom', null);
      svg.selectAll('*').remove();

      nodeSelectionRef.current = null;
      linkSelectionRef.current = null;
      simulationRef.current = null;
    };
  }, [filteredData, notes, theme, showLabels]);

  useEffect(() => {
    if (!nodeSelectionRef.current || !linkSelectionRef.current) return;

    const isDark = theme === 'dark';

    nodeSelectionRef.current.selectAll<SVGCircleElement, GraphNode>('circle')
      .transition()
      .duration(200)
      .attr('fill', (d: GraphNode) => {
        if (d.id === currentNote?.id) return '#2563EB';
        if (currentNote && (currentNote.links?.includes(d.id) || currentNote.backlinks?.includes(d.id))) {
          return isDark ? '#1e40af' : '#BFDBFE';
        }
        if (d.linkCount === 0) return isDark ? '#1e293b' : '#E5E7EB';
        const clusterColor = COLORS.cluster[d.cluster! % COLORS.cluster.length];
        return isDark ? adjustColorForDark(clusterColor) : clusterColor;
      })
      .attr('stroke', (d: GraphNode) => {
        if (d.id === currentNote?.id) return '#60A5FA';
        if (currentNote && (currentNote.links?.includes(d.id) || currentNote.backlinks?.includes(d.id))) {
          return '#3B82F6';
        }
        if (d.linkCount === 0) return isDark ? '#334155' : '#D1D5DB';
        const clusterColor = COLORS.cluster[d.cluster! % COLORS.cluster.length];
        return isDark ? clusterColor : adjustColorForLight(clusterColor);
      })
      .attr('stroke-width', (d: GraphNode) => {
        if (d.id === currentNote?.id) return 4;
        if (currentNote && (currentNote.links?.includes(d.id) || currentNote.backlinks?.includes(d.id))) {
          return 3;
        }
        return 2;
      });

    linkSelectionRef.current.attr('stroke', (d: GraphLink) => {
      const sourceId = typeof d.source === 'string' ? d.source : d.source.id;
      const targetId = typeof d.target === 'string' ? d.target : d.target.id;

      if (currentNote && (sourceId === currentNote.id || targetId === currentNote.id)) {
        return '#3B82F6';
      }
      return isDark ? '#334155' : '#CBD5E1';
    }).attr('stroke-width', (d: GraphLink) => {
      const sourceId = typeof d.source === 'string' ? d.source : d.source.id;
      const targetId = typeof d.target === 'string' ? d.target : d.target.id;

      if (currentNote && (sourceId === currentNote.id || targetId === currentNote.id)) {
        return 2;
      }
      return 1;
    });
  }, [currentNote, theme]);

  const connectedCount = useMemo(() => {
    const ids = new Set<string>();
    links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      ids.add(sourceId);
      ids.add(targetId);
    });
    return ids.size;
  }, [links]);

  const isolatedCount = nodes.length - connectedCount;

  return (
    <div className="p-3 h-full flex flex-col">
      <GraphControls
        zoom={zoom}
        showLabels={showLabels}
        filterMode={filterMode}
        canUseLocalFilter={!!currentNote}
        onZoomIn={() => handleZoom(0.2)}
        onZoomOut={() => handleZoom(-0.2)}
        onReset={handleReset}
        onToggleLabels={() => setShowLabels(!showLabels)}
        onFilterChange={setFilterMode}
      />

      <div className="flex-1 min-h-0 relative" ref={containerRef}>
        {filteredData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-text-muted">
              <Share2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">暂无笔记数据</p>
            </div>
          </div>
        ) : (
          <>
            <svg ref={svgRef} className="w-full h-full" />
            <GraphStats
              nodeCount={filteredData.nodes.length}
              linkCount={filteredData.links.length}
              isolatedCount={isolatedCount}
              filterMode={filterMode}
            />
            {hoveredNode && <NodeTooltip node={hoveredNode} />}
          </>
        )}
      </div>
    </div>
  );
};

function adjustColorForDark(color: string): string {
  const darken: Record<string, string> = {
    '#165DFF': '#1E40AF',
    '#00B42A': '#15803D',
    '#FF7D00': '#C2410C',
    '#F53F3F': '#B91C1C',
    '#757575': '#525252',
    '#8B5CF6': '#6D28D9',
    '#06B6D4': '#0E7490',
    '#84CC16': '#4D7C0F',
    '#F97316': '#C2410C',
    '#6366F1': '#4338CA'
  };
  return darken[color] || color;
}

function adjustColorForLight(color: string): string {
  const darker: Record<string, string> = {
    '#3B82F6': '#1D4ED8',
    '#10B981': '#059669',
    '#F59E0B': '#D97706',
    '#EF4444': '#DC2626',
    '#8B5CF6': '#7C3AED',
    '#EC4899': '#DB2777',
    '#06B6D4': '#0891B2',
    '#84CC16': '#65A30D',
    '#F97316': '#EA580C',
    '#6366F1': '#4F46E5'
  };
  return darker[color] || color;
}
