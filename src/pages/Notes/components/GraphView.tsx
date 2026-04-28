import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { Share2 } from 'lucide-react';
import { Note } from '../../../db';

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

  const { nodes, links } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const linkList: GraphLink[] = [];

    notes.forEach(note => {
      nodeMap.set(note.id, {
        id: note.id,
        title: note.title,
        radius: note.id === currentNote?.id ? 25 : 15 + (note.links?.length || 0) * 2
      });
    });

    notes.forEach(note => {
      (note.links || []).forEach(linkedTitle => {
        const linkedNote = notes.find(n => n.title === linkedTitle);
        if (linkedNote && nodeMap.has(linkedNote.id)) {
          linkList.push({
            source: note.id,
            target: linkedNote.id
          });
        }
      });
    });

    return {
      nodes: Array.from(nodeMap.values()),
      links: linkList
    };
  }, [notes, currentNote]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => d.radius + 5));

    simulationRef.current = simulation;

    const link = svg.append('g')
      .attr('stroke', '#9CA3AF')
      .attr('stroke-opacity', 0.6)
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke-width', 1.5);

    const node = svg.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    node.append('circle')
      .attr('r', d => d.radius)
      .attr('fill', d => {
        if (d.id === currentNote?.id) return '#2563EB';
        return '#E5E7EB';
      })
      .attr('stroke', d => {
        if (d.id === currentNote?.id) return '#3B82F6';
        return '#9CA3AF';
      })
      .attr('stroke-width', d => d.id === currentNote?.id ? 3 : 1);

    node.append('text')
      .text(d => d.title.length > 10 ? d.title.slice(0, 10) + '...' : d.title)
      .attr('text-anchor', 'middle')
      .attr('dy', d => d.radius + 14)
      .attr('font-size', '11px')
      .attr('fill', '#374151')
      .attr('pointer-events', 'none');

    node.on('click', (event, d) => {
      const note = notes.find(n => n.id === d.id);
      if (note) onSelectNote(note);
    });

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x || 0)
        .attr('y1', d => (d.source as GraphNode).y || 0)
        .attr('x2', d => (d.target as GraphNode).x || 0)
        .attr('y2', d => (d.target as GraphNode).y || 0);

      node.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links, notes, currentNote, onSelectNote]);

  if (nodes.length === 0) {
    return (
      <div className="p-4 text-center text-gray-400">
        <Share2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">暂无笔记数据</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ minHeight: '300px' }}
      />
    </div>
  );
};
