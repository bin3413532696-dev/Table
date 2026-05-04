require('dotenv').config();

const { PrismaClient } = require('@prisma/client');

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';
const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

function createDefaultKnowledgeDataset(timestamp = Date.now()) {
  return {
    context: {
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
    },
    ontology: {
      classes: [
        { id: 'class:thing', label: 'Thing', description: '知识图中的通用对象基类。', parentIds: [] },
        { id: 'class:project', label: 'Project', description: '项目、产品或工作单元。', parentIds: ['class:thing'] },
        { id: 'class:concept', label: 'Concept', description: '概念、术语、方法论或规则。', parentIds: ['class:thing'] },
        { id: 'class:document', label: 'Document', description: '文档、笔记、规范或说明材料。', parentIds: ['class:thing'] },
        { id: 'class:task', label: 'Task', description: '与现有任务模块映射的任务实体。', parentIds: ['class:thing'] },
        { id: 'class:finance-record', label: 'FinanceRecord', description: '与现有财务模块映射的财务记录实体。', parentIds: ['class:thing'] },
      ],
      relations: [
        { id: 'relation:relatedTo', label: 'relatedTo', description: '通用关联关系。', symmetric: true },
        { id: 'relation:partOf', label: 'partOf', description: '组成/隶属关系。', transitive: true },
        { id: 'relation:dependsOn', label: 'dependsOn', description: '依赖关系。' },
        { id: 'relation:mentions', label: 'mentions', description: '文档或实体提及其他实体。' },
        { id: 'relation:linkedTask', label: 'linkedTask', description: '知识实体与任务实体之间的映射关系。' },
        { id: 'relation:linkedFinanceRecord', label: 'linkedFinanceRecord', description: '知识实体与财务实体之间的映射关系。' },
      ],
    },
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

async function main() {
  const existingUser = await prisma.user.findUnique({
    where: {
      id: DEFAULT_USER_ID,
    },
  });

  if (existingUser) {
    await prisma.user.update({
      where: {
        id: DEFAULT_USER_ID,
      },
      data: {
        displayName: 'Default Local User',
        status: 'active',
      },
    });
  } else {
    await prisma.user.create({
      data: {
        id: DEFAULT_USER_ID,
        displayName: 'Default Local User',
        status: 'active',
      },
    });
  }

  const existingSettings = await prisma.userSetting.findUnique({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  if (!existingSettings) {
    await prisma.userSetting.create({
      data: {
        userId: DEFAULT_USER_ID,
        theme: 'light',
        profile_json: {},
        notification_json: {},
        agentPreferencesJson: {},
      },
    });
  }

  await prisma.task.deleteMany({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  await prisma.financeRecord.deleteMany({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  await prisma.knowledgeAssertionEvidenceLink.deleteMany({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  await prisma.knowledgeDocumentEntityLink.deleteMany({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  await prisma.knowledgeRelationRecord.deleteMany({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  await prisma.knowledgeAssertionRecord.deleteMany({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  await prisma.knowledgeDocumentRecord.deleteMany({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  await prisma.knowledgeEntityRecord.deleteMany({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  await prisma.knowledgeBase.deleteMany({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });

  await prisma.task.createMany({
    data: [
      {
        userId: DEFAULT_USER_ID,
        title: '梳理存储层改造边界',
        completed: false,
        priority: 'high',
        dueDate: new Date('2026-05-10'),
        notes: '明确前后端职责与迁移路径',
      },
      {
        userId: DEFAULT_USER_ID,
        title: '落地 PostgreSQL 权威写路径',
        completed: true,
        priority: 'medium',
        dueDate: new Date('2026-05-03'),
        notes: '第一阶段基础能力',
      },
    ],
  });

  await prisma.financeRecord.createMany({
    data: [
      {
        userId: DEFAULT_USER_ID,
        type: 'expense',
        amount: 299.0,
        category: 'infrastructure',
        description: 'PostgreSQL 环境准备',
        recordDate: new Date('2026-05-04'),
        model: 'backend',
        metadataJson: {},
      },
      {
        userId: DEFAULT_USER_ID,
        type: 'income',
        amount: 1200.0,
        category: 'project',
        description: '阶段性项目结算',
        recordDate: new Date('2026-05-01'),
        model: 'delivery',
        metadataJson: {},
      },
    ],
  });

  await prisma.knowledgeBase.create({
    data: {
      userId: DEFAULT_USER_ID,
      datasetJson: {
        context: createDefaultKnowledgeDataset().context,
        updatedAt: createDefaultKnowledgeDataset().updatedAt,
      },
    },
  });

  const knowledgeDataset = createDefaultKnowledgeDataset();

  await prisma.knowledgeOntologyClassRecord.createMany({
    data: knowledgeDataset.ontology.classes.map((item) => ({
      id: item.id,
      userId: DEFAULT_USER_ID,
      label: item.label,
      description: item.description || '',
      parentIdsJson: item.parentIds || [],
      createdAt: new Date(knowledgeDataset.updatedAt),
      updatedAt: new Date(knowledgeDataset.updatedAt),
    })),
  });

  await prisma.knowledgeOntologyRelationRecord.createMany({
    data: knowledgeDataset.ontology.relations.map((item) => ({
      id: item.id,
      userId: DEFAULT_USER_ID,
      label: item.label,
      description: item.description || '',
      symmetric: item.symmetric === true,
      transitive: item.transitive === true,
      inverseOf: item.inverseOf || null,
      createdAt: new Date(knowledgeDataset.updatedAt),
      updatedAt: new Date(knowledgeDataset.updatedAt),
    })),
  });

  await prisma.knowledgeEntityRecord.createMany({
    data: knowledgeDataset.entities.map((entity) => ({
      id: entity.id,
      userId: DEFAULT_USER_ID,
      typeId: entity.typeId,
      title: entity.title,
      summary: entity.summary,
      aliasesJson: entity.aliases,
      tagsJson: entity.tags,
      attributesJson: entity.attributes,
      source: entity.source ?? null,
      confidence: entity.confidence ?? null,
      createdAt: new Date(entity.createdAt),
      updatedAt: new Date(entity.updatedAt),
    })),
  });

  await prisma.knowledgeDocumentRecord.createMany({
    data: knowledgeDataset.documents.map((document) => ({
      id: document.id,
      userId: DEFAULT_USER_ID,
      title: document.title,
      summary: document.summary,
      content: document.content,
      tagsJson: document.tags,
      source: document.source ?? null,
      createdAt: new Date(document.createdAt),
      updatedAt: new Date(document.updatedAt),
    })),
  });

  await prisma.knowledgeDocumentEntityLink.createMany({
    data: knowledgeDataset.documents.flatMap((document) =>
      document.entityIds.map((entityId) => ({
        userId: DEFAULT_USER_ID,
        documentId: document.id,
        entityId,
      }))
    ),
  });

  await prisma.knowledgeAssertionRecord.createMany({
    data: knowledgeDataset.assertions.map((assertion) => ({
      id: assertion.id,
      userId: DEFAULT_USER_ID,
      subjectId: assertion.subjectId,
      predicateId: assertion.predicateId,
      objectId: assertion.objectId ?? null,
      scalarValueJson: assertion.value ?? null,
      source: assertion.source ?? null,
      confidence: assertion.confidence ?? null,
      createdAt: new Date(assertion.createdAt),
      updatedAt: new Date(assertion.updatedAt),
    })),
  });

  await prisma.knowledgeAssertionEvidenceLink.createMany({
    data: knowledgeDataset.assertions.flatMap((assertion) =>
      assertion.evidenceDocumentIds.map((documentId) => ({
        userId: DEFAULT_USER_ID,
        assertionId: assertion.id,
        documentId,
      }))
    ),
  });

  console.log('Seed completed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
