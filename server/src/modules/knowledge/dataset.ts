function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const KNOWLEDGE_CONTEXT = {
  '@vocab': 'https://workspace.local/ontology#',
  type: '@type',
  id: '@id',
  label: 'rdfs:label',
  summary: 'schema:description',
  source: 'schema:citation',
  aliases: { '@id': 'schema:alternateName', '@container': '@set' },
  tags: { '@id': 'schema:keywords', '@container': '@set' },
  relatedTo: { '@id': 'workspace:relatedTo', '@type': '@id' },
  partOf: { '@id': 'workspace:partOf', '@type': '@id' },
  dependsOn: { '@id': 'workspace:dependsOn', '@type': '@id' },
} as const;

const DEFAULT_ONTOLOGY = {
  classes: [
    {
      id: 'class:thing',
      label: 'Thing',
      description: '知识图中的通用对象基类。',
      parentIds: [],
    },
    {
      id: 'class:project',
      label: 'Project',
      description: '项目、产品或工作单元。',
      parentIds: ['class:thing'],
    },
    {
      id: 'class:concept',
      label: 'Concept',
      description: '概念、术语、方法论或规则。',
      parentIds: ['class:thing'],
    },
    {
      id: 'class:document',
      label: 'Document',
      description: '文档、笔记、规范或说明材料。',
      parentIds: ['class:thing'],
    },
    {
      id: 'class:task',
      label: 'Task',
      description: '与现有任务模块映射的任务实体。',
      parentIds: ['class:thing'],
    },
    {
      id: 'class:finance-record',
      label: 'FinanceRecord',
      description: '与现有财务模块映射的财务记录实体。',
      parentIds: ['class:thing'],
    },
  ],
  relations: [
    {
      id: 'relation:relatedTo',
      label: 'relatedTo',
      description: '通用关联关系。',
      symmetric: true,
    },
    {
      id: 'relation:partOf',
      label: 'partOf',
      description: '组成/隶属关系。',
      transitive: true,
    },
    {
      id: 'relation:dependsOn',
      label: 'dependsOn',
      description: '依赖关系。',
    },
    {
      id: 'relation:mentions',
      label: 'mentions',
      description: '文档或实体提及其他实体。',
    },
    {
      id: 'relation:linkedTask',
      label: 'linkedTask',
      description: '知识实体与任务实体之间的映射关系。',
    },
    {
      id: 'relation:linkedFinanceRecord',
      label: 'linkedFinanceRecord',
      description: '知识实体与财务实体之间的映射关系。',
    },
  ],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFiniteTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createDefaultKnowledgeDataset(timestamp = Date.now()) {
  return {
    context: clone(KNOWLEDGE_CONTEXT),
    ontology: clone(DEFAULT_ONTOLOGY),
    entities: [
      {
        id: 'entity:workspace',
        typeId: 'class:project',
        title: '个人工作站',
        summary: '当前 React + TypeScript 项目的主实体。',
        aliases: ['Workspace', '工作站项目'],
        tags: ['project', 'workspace'],
        attributes: {
          status: 'active',
          stack: 'React 18 + TypeScript + Webpack 5 + Tailwind CSS 3',
        },
        relations: [],
        source: '交接文档',
        confidence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    documents: [
      {
        id: 'doc:handover',
        title: '交接文档',
        summary: '项目架构、同步策略与后续计划的权威说明。',
        content: '当前项目交接文档，包含数据同步、智能体和知识库接入计划。',
        tags: ['handover', 'documentation'],
        entityIds: ['entity:workspace'],
        source: '交接文档.md',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    assertions: [
      {
        id: 'assertion:workspace-handover',
        subjectId: 'entity:workspace',
        predicateId: 'relation:relatedTo',
        objectId: 'doc:handover',
        evidenceDocumentIds: ['doc:handover'],
        source: '交接文档',
        confidence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    updatedAt: timestamp,
  };
}

export function normalizeKnowledgeDataset(raw: unknown) {
  const timestamp = Date.now();

  if (!isRecord(raw)) {
    return createDefaultKnowledgeDataset(timestamp);
  }

  const source = clone(raw);
  const context = isRecord(source.context) ? source.context : clone(KNOWLEDGE_CONTEXT);
  const ontologySource = isRecord(source.ontology) ? source.ontology : {};

  return {
    context,
    ontology: {
      classes: Array.isArray(ontologySource.classes) ? ontologySource.classes : [],
      relations: Array.isArray(ontologySource.relations) ? ontologySource.relations : [],
    },
    entities: Array.isArray(source.entities) ? source.entities : [],
    documents: Array.isArray(source.documents) ? source.documents : [],
    assertions: Array.isArray(source.assertions) ? source.assertions : [],
    updatedAt: toFiniteTimestamp(source.updatedAt, timestamp),
  };
}
