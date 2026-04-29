export interface GraphNode {
  id: string;
  title: string;
  radius: number;
  linkCount: number;
  outLinks: number;
  inLinks: number;
  tags: string[];
  cluster?: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

export const COLORS = {
  cluster: [
    '#165DFF', '#00B42A', '#FF7D00', '#F53F3F', '#757575',
    '#8B5CF6', '#06B6D4', '#84CC16', '#F97316', '#6366F1'
  ]
};
