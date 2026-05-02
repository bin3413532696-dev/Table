import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';

interface GraphNode {
  id: string;
  title: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface GraphViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick?: (nodeId: string) => void;
  width?: number;
  height?: number;
}

export default function GraphView({
  nodes,
  links,
  onNodeClick,
  width: propWidth,
  height: propHeight,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

  // 监听容器尺寸变化
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: propWidth || rect.width || 600,
          height: propHeight || rect.height || 400,
        });
      }
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, [propWidth, propHeight]);

  const { width, height } = dimensions;

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const simulation = d3
      .forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force(
        'link',
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance(100)
      )
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2));

    const container = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });

    svg.call(zoom);

    const link = container
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', 'var(--border-primary)')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1.5);

    const node = container
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d: any) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d: any) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d: any) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    node
      .append('circle')
      .attr('r', 8)
      .attr('fill', (d) => (d.id === selectedNode ? 'var(--color-primary)' : 'var(--bg-tertiary)'))
      .attr('stroke', 'var(--border-primary)')
      .attr('stroke-width', 2)
      .on('click', (_, d: any) => {
        setSelectedNode(d.id);
        onNodeClick?.(d.id);
      });

    node
      .append('text')
      .text((d) => d.title || d.id)
      .attr('font-size', '12px')
      .attr('fill', 'var(--text-primary)')
      .attr('dx', 12)
      .attr('dy', 4);

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links, width, height, selectedNode, onNodeClick]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        暂无笔记链接关系
      </div>
    );
  }

  return (
    <div ref={containerRef} className="graph-container h-full w-full" style={{ overflow: 'hidden' }}>
      <svg ref={svgRef} width={width} height={height} />
    </div>
  );
}

export function buildGraphData(
  notes: Array<{ id: string; title: string; links: string[] }>
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeMap = new Map<string, GraphNode>();
  const linkSet = new Set<string>();
  const graphLinks: GraphLink[] = [];

  notes.forEach((note) => {
    if (!nodeMap.has(note.id)) {
      nodeMap.set(note.id, { id: note.id, title: note.title });
    }

    note.links.forEach((targetId) => {
      if (!nodeMap.has(targetId)) {
        nodeMap.set(targetId, { id: targetId, title: targetId });
      }

      const linkKey = `${note.id}->${targetId}`;
      if (!linkSet.has(linkKey)) {
        linkSet.add(linkKey);
        graphLinks.push({ source: note.id, target: targetId });
      }
    });
  });

  return {
    nodes: Array.from(nodeMap.values()),
    links: graphLinks,
  };
}