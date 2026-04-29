import React, { useCallback } from 'react';
import { Note } from '../../../db';
import { GraphNode, GraphLink, COLORS } from './types';

export function useGraphData(notes: Note[]) {
  const buildGraph = useCallback(() => {
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    const titleToId = new Map<string, string>();
    notes.forEach(n => titleToId.set(n.title, n.id));

    const outLinks = new Map<string, number>();
    const inLinks = new Map<string, number>();
    const links: GraphLink[] = [];

    notes.forEach(note => {
      const matches = note.content?.matchAll(linkRegex) || [];
      for (const match of matches) {
        const targetTitle = match[1];
        const targetId = titleToId.get(targetTitle);
        if (targetId && targetId !== note.id) {
          links.push({ source: note.id, target: targetId });
          outLinks.set(note.id, (outLinks.get(note.id) || 0) + 1);
          inLinks.set(targetId, (inLinks.get(targetId) || 0) + 1);
        }
      }
    });

    const tagRegex = /#(\S+)/g;
    const tagMap = new Map<string, number[]>();
    notes.forEach(note => {
      const tags = new Set<string>();
      const tagMatches = note.content?.matchAll(tagRegex) || [];
      for (const m of tagMatches) tags.add(m[1]);
      tags.forEach(tag => {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push(note.id);
      });
    });

    const clusterMap = new Map<string, number>();
    let clusterIdx = 0;
    tagMap.forEach((noteIds, tag) => {
      if (noteIds.length > 1) {
        if (!clusterMap.has(tag)) {
          clusterMap.set(tag, clusterIdx++);
        }
      }
    });

    const nodeCluster = new Map<string, number>();
    tagMap.forEach((noteIds, tag) => {
      if (noteIds.length > 1) {
        const c = clusterMap.get(tag)!;
        noteIds.forEach(id => nodeCluster.set(id, c));
      }
    });

    const nodes: GraphNode[] = notes.map(note => {
      const totalLinks = (outLinks.get(note.id) || 0) + (inLinks.get(note.id) || 0);
      const tags: string[] = [];
      const tagMatches = note.content?.matchAll(tagRegex) || [];
      for (const m of tagMatches) tags.push(m[1]);

      return {
        id: note.id,
        title: note.title,
        radius: Math.max(6, Math.min(24, 6 + totalLinks * 3)),
        linkCount: totalLinks,
        outLinks: outLinks.get(note.id) || 0,
        inLinks: inLinks.get(note.id) || 0,
        tags,
        cluster: nodeCluster.get(note.id),
      };
    });

    return { nodes, links };
  }, [notes]);

  return { buildGraph };
}
