import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { Share2 } from 'lucide-react';
import { Note } from '../../../db';
import { useTheme } from '../../../contexts/ThemeContext';

interface GraphViewProps {
  notes: Note[];
  currentNote: Note | null;
  onSelectNote: (note: Note) => void;
}

interface GraphNode {
  id: string;
  title: string;
  radius: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

export const GraphView: React.FC<GraphViewProps> = ({
  notes,
  currentNote,
  onSelectNote
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const nodeSelectionRef = useRef<d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null);
  const onSelectNoteRef = useRef(onSelectNote);
  const { theme } = useTheme();

  useEffect(() => {
    onSelectNoteRef.current = onSelectNote;
  }, [onSelectNote]);

  const { nodes, links } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const linkList: GraphLink[] = [];

    notes.forEach(note => {
      nodeMap.set(note.id, {
        id: note.id,
        title: note.title,
        radius: 15 + (note.links?.length || 0) * 2
      });
    });

    notes.forEach(note => {
      (note.links || []).forEach(linkedNoteId => {
        if (nodeMap.has(linkedNoteId)) {
          linkList.push({
            source: note.id,
            target: linkedNoteId
          });
        }
      });
    });

    return {
      nodes: Array.from(nodeMap.values()),
      links: linkList
    };
  }, [notes]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const isDark = theme === 'dark';
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links).id((d: GraphNode) => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius((d: GraphNode) => d.radius + 5));

    simulationRef.current = simulation;

    const link = svg.append('g')
      .attr('stroke', isDark ? '#475569' : '#9CA3AF')
      .attr('stroke-opacity', 0.6)
      .selectAll('line')
      .data(links)
      .join<SVGLineElement>('line')
      .attr('stroke-width', 1.5);

    const node = svg.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer') as unknown as d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;

    nodeSelectionRef.current = node;

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

    node.append('circle')
      .attr('r', (d: GraphNode) => d.radius)
      .attr('fill', isDark ? '#334155' : '#E5E7EB')
      .attr('stroke', isDark ? '#475569' : '#9CA3AF')
      .attr('stroke-width', 1);

    node.append('text')
      .text((d: GraphNode) => d.title.length > 10 ? d.title.slice(0, 10) + '...' : d.title)
      .attr('text-anchor', 'middle')
      .attr('dy', (d: GraphNode) => d.radius + 14)
      .attr('font-size', '11px')
      .attr('fill', isDark ? '#cbd5e1' : '#374151')
      .attr('pointer-events', 'none');

    node.on('click', (event: MouseEvent, d: GraphNode) => {
      const note = notes.find(n => n.id === d.id);
      if (note) onSelectNoteRef.current(note);
    });

    simulation.on('tick', () => {
      link
        .attr('x1', (d: GraphLink) => (d.source as GraphNode).x || 0)
        .attr('y1', (d: GraphLink) => (d.source as GraphNode).y || 0)
        .attr('x2', (d: GraphLink) => (d.target as GraphNode).x || 0)
        .attr('y2', (d: GraphLink) => (d.target as GraphNode).y || 0);

      node.attr('transform', (d: GraphNode) => `translate(${d.x || 0},${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links, notes]);

  useEffect(() => {
    if (!nodeSelectionRef.current || !currentNote) return;

    const isDark = theme === 'dark';
    nodeSelectionRef.current.selectAll('circle')
      .transition()
      .duration(200)
      .attr('fill', (d: GraphNode) => d.id === currentNote?.id ? '#2563EB' : isDark ? '#334155' : '#E5E7EB')
      .attr('stroke', (d: GraphNode) => d.id === currentNote?.id ? '#3B82F6' : isDark ? '#475569' : '#9CA3AF')
      .attr('stroke-width', (d: GraphNode) => d.id === currentNote?.id ? 3 : 1);
  }, [currentNote]);

  if (nodes.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted">
        <Share2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">暂无笔记数据</p>
      </div>
    );
  }

  return (
    <div className="p-3 h-full flex flex-col">
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 text-text-muted">
        知识图谱
      </h3>
      <div className="flex-1 min-h-0">
        <svg
          ref={svgRef}
          className="w-full h-full"
        />
      </div>
    </div>
  );
};
