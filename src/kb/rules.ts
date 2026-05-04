import { KnowledgeDataset, KnowledgeEntity, KnowledgeRelationEdge, OntologyRelation } from './types';

function buildRelationMap(dataset: KnowledgeDataset): Map<string, OntologyRelation> {
  return new Map(dataset.ontology.relations.map((relation) => [relation.id, relation]));
}

export function buildEntityMap(dataset: KnowledgeDataset): Map<string, KnowledgeEntity> {
  return new Map(dataset.entities.map((entity) => [entity.id, entity]));
}

function shouldTreatAsBidirectional(relation?: OntologyRelation): boolean {
  return Boolean(relation?.symmetric || relation?.inverseId);
}

export function expandEntityRelations(
  dataset: KnowledgeDataset,
  entityId: string,
  depth = 1
): KnowledgeEntity[] {
  if (depth < 1) {
    return [];
  }

  const relationMap = buildRelationMap(dataset);
  const entityMap = buildEntityMap(dataset);
  const visited = new Set<string>([entityId]);
  const queue: Array<{ id: string; remainingDepth: number }> = [{ id: entityId, remainingDepth: depth }];
  const result: KnowledgeEntity[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const entity = entityMap.get(current.id);
    if (!entity) {
      continue;
    }

    const outboundEdges: KnowledgeRelationEdge[] = [...entity.relations];
    const inboundEdges = dataset.entities.flatMap((candidate) =>
      candidate.relations.flatMap((relation) => {
        if (relation.targetId !== entity.id) {
          return [];
        }

        const relationMeta = relationMap.get(relation.predicateId);
        if (!shouldTreatAsBidirectional(relationMeta)) {
          return [];
        }

        return [{ ...relation, targetId: candidate.id }];
      })
    );

    const assertionEdges = dataset.assertions.flatMap((assertion) => {
      if (assertion.subjectId === entity.id && assertion.objectId) {
        return [{ predicateId: assertion.predicateId, targetId: assertion.objectId }];
      }

      if (assertion.objectId === entity.id) {
        const relationMeta = relationMap.get(assertion.predicateId);
        if (!shouldTreatAsBidirectional(relationMeta)) {
          return [];
        }

        return [{ predicateId: assertion.predicateId, targetId: assertion.subjectId }];
      }

      return [];
    });

    for (const edge of [...outboundEdges, ...inboundEdges, ...assertionEdges]) {
      const target = entityMap.get(edge.targetId);
      if (!target || visited.has(target.id)) {
        continue;
      }

      visited.add(target.id);
      result.push(target);

      const relation = relationMap.get(edge.predicateId);
      if (current.remainingDepth > 1 || relation?.transitive) {
        queue.push({ id: target.id, remainingDepth: current.remainingDepth - 1 });
      }
    }
  }

  return result;
}
