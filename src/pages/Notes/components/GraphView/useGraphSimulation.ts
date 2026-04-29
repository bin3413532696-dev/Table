import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Note } from '../../../db';
import { GraphNode, GraphLink, COLORS } from './types';

interface UseGraphSimulationProps {
  svgRef: React.RefObject<SVGSVGElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  nodes: GraphNode[];
  links: GraphLink[];
  notes: Note[];
  theme: string;
  showLabels: boolean;
  onNodeClick: (note: Note) => void;
  onNodeHover: (node: GraphNode | null) => void;
}

export function useGraphSimulation({
  svgRef,
  containerRef,
  nodes,
  links,
  notes,
  theme,
  showLabels,
  onNodeClick,
  onNodeHover
}: UseGraphSimulationProps) {
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const nodeSelectionRef = useRef<d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null);
  const linkSelectionRef = useRef<d3.Selection<SVGLineElement, GraphLink, SVGGElement, GraphLink> | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeHoverRef = useRef(onNodeHover);

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
    onNodeHoverRef.current = onNodeHover;
  }, [onNodeClick, onNodeHover]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const isDark = theme === 'dark';
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = containerRef.current;
    const width = container?.clientWidth || 300;
    const height = container?.clientHeight || 300;

    const g = svg.append('g').attr('class', 'graph-container');

    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
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
      .data(links)
      .join<SVGLineElement>('line')
      .attr('stroke', isDark ? '#334155' : '#CBD5E1')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1);

    linkSelectionRef.current = link as d3.Selection<SVGLineElement, GraphLink, SVGGElement, GraphLink>;

    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
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
      if (note) onNodeClickRef.current(note);
    });

    node.on('mouseenter', (event: MouseEvent, d: GraphNode) => {
      onNodeHoverRef.current(d);
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
        const isConnected = links.some(l => {
          const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
          const targetId = typeof l.target === 'string' ? l.target : l.target.id;
          return (sourceId === d.id && targetId === n.id) || (targetId === d.id && sourceId === n.id);
        });
        return n.id === d.id || isConnected ? 1 : 0.3;
      });
    });

    node.on('mouseleave', () => {
      onNodeHoverRef.current(null);
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
  }, [nodes, links, notes, theme, showLabels]);

  return { simulationRef, nodeSelectionRef, linkSelectionRef };
}

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
