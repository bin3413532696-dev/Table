import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client';
import { createDefaultKnowledgeDataset, normalizeKnowledgeDataset } from './dataset';
import type {
  CreateKnowledgeRelationInput,
  UpsertKnowledgeAssertionInput,
  UpsertKnowledgeDocumentInput,
  UpsertKnowledgeEntityInput,
} from './schema';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

export type KnowledgeRelationEdgeRecord = {
  predicateId: string;
  targetId: string;
  source?: string;
  confidence?: number;
};

export type KnowledgeEntityRecordShape = {
  id: string;
  typeId: string;
  title: string;
  summary: string;
  aliases: string[];
  tags: string[];
  attributes: Record<string, unknown>;
  relations: KnowledgeRelationEdgeRecord[];
  source?: string;
  confidence?: number;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeDocumentRecordShape = {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  entityIds: string[];
  source?: string;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeAssertionRecordShape = {
  id: string;
  subjectId: string;
  predicateId: string;
  objectId?: string;
  value?: string | number | boolean | null;
  evidenceDocumentIds: string[];
  source?: string;
  confidence?: number;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeDatasetRecordShape = {
  context: Record<string, unknown>;
  ontology: {
    classes: readonly unknown[];
    relations: readonly unknown[];
  };
  entities: KnowledgeEntityRecordShape[];
  documents: KnowledgeDocumentRecordShape[];
  assertions: KnowledgeAssertionRecordShape[];
  updatedAt: number;
};

type SeedKnowledgeDataset = ReturnType<typeof createDefaultKnowledgeDataset>;

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toNullableScalar(value: unknown): string | number | boolean | null | undefined {
  return value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? value
    : undefined;
}

function toTimestamp(value: Date): number {
  return value.getTime();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeStringArray(values?: string[]) {
  return Array.from(new Set((values ?? []).map((item) => item.trim()).filter(Boolean)));
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function createUniqueId(prefix: string, label: string, existingIds: Set<string>): string {
  const base = slugify(label) || Date.now().toString(36);
  let candidate = `${prefix}:${base}`;
  let index = 1;

  while (existingIds.has(candidate)) {
    candidate = `${prefix}:${base}-${index}`;
    index += 1;
  }

  return candidate;
}

function toOntologyClassRecord(value: unknown) {
  const record = toRecord(value);
  const id = typeof record.id === 'string' ? record.id : '';
  const label = typeof record.label === 'string' ? record.label : id;

  return {
    id,
    label,
    description: typeof record.description === 'string' ? record.description : '',
    parentIds: toStringArray(record.parentIds),
  };
}

function toOntologyRelationRecord(value: unknown) {
  const record = toRecord(value);
  const id = typeof record.id === 'string' ? record.id : '';
  const label = typeof record.label === 'string' ? record.label : id;

  return {
    id,
    label,
    description: typeof record.description === 'string' ? record.description : '',
    symmetric: record.symmetric === true,
    transitive: record.transitive === true,
    ...(typeof record.inverseOf === 'string' ? { inverseOf: record.inverseOf } : {}),
  };
}

async function touchKnowledgeMetadata(timestamp: Date, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const payload = {
    context: clone(createDefaultKnowledgeDataset(timestamp.getTime()).context),
    updatedAt: timestamp.getTime(),
  };

  const existing = await db.knowledgeBase.findUnique({
    where: { userId: DEFAULT_USER_ID },
  });

  if (!existing) {
    await db.knowledgeBase.create({
      data: {
        userId: DEFAULT_USER_ID,
        datasetJson: asJsonValue(payload),
      },
    });
    return;
  }

  const normalized = normalizeKnowledgeDataset(existing.datasetJson);

  await db.knowledgeBase.update({
    where: { userId: DEFAULT_USER_ID },
    data: {
      datasetJson: asJsonValue({
        context: normalized.context,
        updatedAt: timestamp.getTime(),
      }),
      version: {
        increment: 1,
      },
    },
  });
}

export async function findKnowledgeBase() {
  return prisma.knowledgeBase.findUnique({
    where: {
      userId: DEFAULT_USER_ID,
    },
  });
}

async function seedStructuredKnowledge(tx: Prisma.TransactionClient, dataset: KnowledgeDatasetRecordShape) {
  const ontologyClassRows = dataset.ontology.classes
    .map((item) => toOntologyClassRecord(item))
    .filter((item) => item.id);

  if (ontologyClassRows.length > 0) {
    await tx.knowledgeOntologyClassRecord.createMany({
      data: ontologyClassRows.map((item) => ({
        id: item.id,
        userId: DEFAULT_USER_ID,
        label: item.label,
        description: item.description,
        parentIdsJson: asJsonValue(item.parentIds),
        createdAt: new Date(dataset.updatedAt),
        updatedAt: new Date(dataset.updatedAt),
      })),
    });
  }

  const ontologyRelationRows = dataset.ontology.relations
    .map((item) => toOntologyRelationRecord(item))
    .filter((item) => item.id);

  if (ontologyRelationRows.length > 0) {
    await tx.knowledgeOntologyRelationRecord.createMany({
      data: ontologyRelationRows.map((item) => ({
        id: item.id,
        userId: DEFAULT_USER_ID,
        label: item.label,
        description: item.description,
        symmetric: item.symmetric,
        transitive: item.transitive,
        inverseOf: item.inverseOf ?? null,
        createdAt: new Date(dataset.updatedAt),
        updatedAt: new Date(dataset.updatedAt),
      })),
    });
  }

  await tx.knowledgeEntityRecord.createMany({
    data: dataset.entities.map((entity) => ({
      id: entity.id,
      userId: DEFAULT_USER_ID,
      typeId: entity.typeId,
      title: entity.title,
      summary: entity.summary,
      aliasesJson: asJsonValue(entity.aliases),
      tagsJson: asJsonValue(entity.tags),
      attributesJson: asJsonValue(entity.attributes),
      source: entity.source ?? null,
      confidence: entity.confidence ?? null,
      createdAt: new Date(entity.createdAt),
      updatedAt: new Date(entity.updatedAt),
    })),
  });

  const relationRows = dataset.entities.flatMap((entity) =>
    entity.relations.map((relation: KnowledgeRelationEdgeRecord) => ({
      userId: DEFAULT_USER_ID,
      subjectId: entity.id,
      predicateId: relation.predicateId,
      targetId: relation.targetId,
      source: relation.source ?? null,
      confidence: relation.confidence ?? null,
      createdAt: new Date(entity.createdAt),
      updatedAt: new Date(entity.updatedAt),
    }))
  );

  if (relationRows.length > 0) {
    await tx.knowledgeRelationRecord.createMany({
      data: relationRows,
    });
  }

  await tx.knowledgeDocumentRecord.createMany({
    data: dataset.documents.map((document) => ({
      id: document.id,
      userId: DEFAULT_USER_ID,
      title: document.title,
      summary: document.summary,
      content: document.content,
      tagsJson: asJsonValue(document.tags),
      source: document.source ?? null,
      createdAt: new Date(document.createdAt),
      updatedAt: new Date(document.updatedAt),
    })),
  });

  const documentLinks = dataset.documents.flatMap((document) =>
    document.entityIds.map((entityId) => ({
      userId: DEFAULT_USER_ID,
      documentId: document.id,
      entityId,
    }))
  );

  if (documentLinks.length > 0) {
    await tx.knowledgeDocumentEntityLink.createMany({
      data: documentLinks,
    });
  }

  await tx.knowledgeAssertionRecord.createMany({
    data: dataset.assertions.map((assertion) => ({
      id: assertion.id,
      userId: DEFAULT_USER_ID,
      subjectId: assertion.subjectId,
      predicateId: assertion.predicateId,
      objectId: assertion.objectId ?? null,
      scalarValueJson:
        assertion.value === undefined
          ? Prisma.DbNull
          : asJsonValue(assertion.value),
      source: assertion.source ?? null,
      confidence: assertion.confidence ?? null,
      createdAt: new Date(assertion.createdAt),
      updatedAt: new Date(assertion.updatedAt),
    })),
  });

  const evidenceRows = dataset.assertions.flatMap((assertion) =>
    assertion.evidenceDocumentIds.map((documentId) => ({
      userId: DEFAULT_USER_ID,
      assertionId: assertion.id,
      documentId,
    }))
  );

  if (evidenceRows.length > 0) {
    await tx.knowledgeAssertionEvidenceLink.createMany({
      data: evidenceRows,
    });
  }
}

export async function ensureKnowledgeBase() {
  const existing = await findKnowledgeBase();
  if (existing) {
    return existing;
  }

  const dataset = createDefaultKnowledgeDataset() as unknown as KnowledgeDatasetRecordShape;

  return prisma.$transaction(async (tx) => {
    const base = await tx.knowledgeBase.create({
      data: {
        userId: DEFAULT_USER_ID,
        datasetJson: asJsonValue({
          context: dataset.context,
          updatedAt: dataset.updatedAt,
        }),
      },
    });

    await seedStructuredKnowledge(tx, dataset);
    return base;
  });
}

export async function getKnowledgeDatasetRecord(): Promise<KnowledgeDatasetRecordShape> {
  const base = await ensureKnowledgeBase();
  const meta = normalizeKnowledgeDataset(base.datasetJson);

  const [ontologyClasses, ontologyRelations, entities, relations, documents, documentLinks, assertions, evidenceLinks] = await Promise.all([
    prisma.knowledgeOntologyClassRecord.findMany({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.knowledgeOntologyRelationRecord.findMany({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.knowledgeEntityRecord.findMany({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.knowledgeRelationRecord.findMany({
      where: { userId: DEFAULT_USER_ID },
    }),
    prisma.knowledgeDocumentRecord.findMany({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.knowledgeDocumentEntityLink.findMany({
      where: { userId: DEFAULT_USER_ID },
    }),
    prisma.knowledgeAssertionRecord.findMany({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.knowledgeAssertionEvidenceLink.findMany({
      where: { userId: DEFAULT_USER_ID },
    }),
  ]);

  const relationMap = new Map<string, Array<{
    predicateId: string;
    targetId: string;
    source?: string;
    confidence?: number;
  }>>();

  for (const relation of relations) {
    const current = relationMap.get(relation.subjectId) ?? [];
    current.push({
      predicateId: relation.predicateId,
      targetId: relation.targetId,
      source: relation.source ?? undefined,
      confidence: relation.confidence ?? undefined,
    });
    relationMap.set(relation.subjectId, current);
  }

  const documentEntityMap = new Map<string, string[]>();
  for (const link of documentLinks) {
    const current = documentEntityMap.get(link.documentId) ?? [];
    current.push(link.entityId);
    documentEntityMap.set(link.documentId, current);
  }

  const evidenceMap = new Map<string, string[]>();
  for (const link of evidenceLinks) {
    const current = evidenceMap.get(link.assertionId) ?? [];
    current.push(link.documentId);
    evidenceMap.set(link.assertionId, current);
  }

  return {
    context: clone(meta.context),
    ontology: {
      classes: ontologyClasses.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        parentIds: toStringArray(item.parentIdsJson),
      })),
      relations: ontologyRelations.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        symmetric: item.symmetric,
        transitive: item.transitive,
        ...(item.inverseOf ? { inverseOf: item.inverseOf } : {}),
      })),
    },
    entities: entities.map((entity): KnowledgeEntityRecordShape => ({
      id: entity.id,
      typeId: entity.typeId,
      title: entity.title,
      summary: entity.summary,
      aliases: toStringArray(entity.aliasesJson),
      tags: toStringArray(entity.tagsJson),
      attributes: toRecord(entity.attributesJson),
      relations: relationMap.get(entity.id) ?? [],
      source: entity.source ?? undefined,
      confidence: entity.confidence ?? undefined,
      createdAt: toTimestamp(entity.createdAt),
      updatedAt: toTimestamp(entity.updatedAt),
    })),
    documents: documents.map((document): KnowledgeDocumentRecordShape => ({
      id: document.id,
      title: document.title,
      summary: document.summary,
      content: document.content,
      tags: toStringArray(document.tagsJson),
      entityIds: documentEntityMap.get(document.id) ?? [],
      source: document.source ?? undefined,
      createdAt: toTimestamp(document.createdAt),
      updatedAt: toTimestamp(document.updatedAt),
    })),
    assertions: assertions.map((assertion): KnowledgeAssertionRecordShape => ({
      id: assertion.id,
      subjectId: assertion.subjectId,
      predicateId: assertion.predicateId,
      objectId: assertion.objectId ?? undefined,
      value: assertion.scalarValueJson === null ? undefined : toNullableScalar(assertion.scalarValueJson),
      evidenceDocumentIds: evidenceMap.get(assertion.id) ?? [],
      source: assertion.source ?? undefined,
      confidence: assertion.confidence ?? undefined,
      createdAt: toTimestamp(assertion.createdAt),
      updatedAt: toTimestamp(assertion.updatedAt),
    })),
    updatedAt:
      [
        meta.updatedAt,
        ...entities.map((entity) => toTimestamp(entity.updatedAt)),
        ...documents.map((document) => toTimestamp(document.updatedAt)),
        ...assertions.map((assertion) => toTimestamp(assertion.updatedAt)),
      ].reduce((max, current) => Math.max(max, current), 0),
  } satisfies KnowledgeDatasetRecordShape;
}

export async function getKnowledgeMetadataRecord() {
  const base = await ensureKnowledgeBase();
  const dataset = await getKnowledgeDatasetRecord();

  return {
    source: 'postgres',
    version: base.version,
    updatedAt: dataset.updatedAt,
    entityCount: dataset.entities.length,
    documentCount: dataset.documents.length,
    assertionCount: dataset.assertions.length,
  };
}

export async function replaceKnowledgeDataset(raw: unknown): Promise<KnowledgeDatasetRecordShape> {
  const dataset = normalizeKnowledgeDataset(raw) as KnowledgeDatasetRecordShape;

  await prisma.$transaction(async (tx) => {
    await tx.knowledgeAssertionEvidenceLink.deleteMany({
      where: { userId: DEFAULT_USER_ID },
    });
    await tx.knowledgeDocumentEntityLink.deleteMany({
      where: { userId: DEFAULT_USER_ID },
    });
    await tx.knowledgeRelationRecord.deleteMany({
      where: { userId: DEFAULT_USER_ID },
    });
    await tx.knowledgeAssertionRecord.deleteMany({
      where: { userId: DEFAULT_USER_ID },
    });
    await tx.knowledgeOntologyRelationRecord.deleteMany({
      where: { userId: DEFAULT_USER_ID },
    });
    await tx.knowledgeOntologyClassRecord.deleteMany({
      where: { userId: DEFAULT_USER_ID },
    });
    await tx.knowledgeDocumentRecord.deleteMany({
      where: { userId: DEFAULT_USER_ID },
    });
    await tx.knowledgeEntityRecord.deleteMany({
      where: { userId: DEFAULT_USER_ID },
    });

    const existing = await tx.knowledgeBase.findUnique({
      where: { userId: DEFAULT_USER_ID },
    });

    if (existing) {
      await tx.knowledgeBase.update({
        where: { userId: DEFAULT_USER_ID },
        data: {
          datasetJson: asJsonValue({
            context: dataset.context,
            updatedAt: dataset.updatedAt,
          }),
          version: {
            increment: 1,
          },
        },
      });
    } else {
      await tx.knowledgeBase.create({
        data: {
          userId: DEFAULT_USER_ID,
          datasetJson: asJsonValue({
            context: dataset.context,
            updatedAt: dataset.updatedAt,
          }),
        },
      });
    }

    await seedStructuredKnowledge(tx, dataset);
  });

  return dataset;
}

export async function listKnowledgeEntityRecords() {
  const dataset = await getKnowledgeDatasetRecord();
  return dataset.entities;
}

export async function listKnowledgeDocumentRecords() {
  const dataset = await getKnowledgeDatasetRecord();
  return dataset.documents;
}

export async function listKnowledgeAssertionRecords() {
  const dataset = await getKnowledgeDatasetRecord();
  return dataset.assertions;
}

export async function upsertKnowledgeEntityStructured(
  input: UpsertKnowledgeEntityInput
): Promise<KnowledgeEntityRecordShape> {
  await ensureKnowledgeBase();
  const now = new Date();
  const nowTs = now.getTime();
  const ids = new Set(
    (
      await prisma.knowledgeEntityRecord.findMany({
        where: { userId: DEFAULT_USER_ID },
        select: { id: true },
      })
    ).map((item) => item.id)
  );

  const existing = input.id
    ? await prisma.knowledgeEntityRecord.findFirst({
        where: {
          userId: DEFAULT_USER_ID,
          id: input.id,
        },
      })
    : null;

  const id = existing?.id || input.id || createUniqueId('entity', input.title, ids);

  const entity = await prisma.knowledgeEntityRecord.upsert({
    where: { id },
    create: {
      id,
      userId: DEFAULT_USER_ID,
      typeId: input.typeId,
      title: input.title.trim(),
      summary: input.summary?.trim() || '',
      aliasesJson: asJsonValue(normalizeStringArray(input.aliases)),
      tagsJson: asJsonValue(normalizeStringArray(input.tags)),
      attributesJson: asJsonValue(input.attributes ?? {}),
      source: input.source?.trim() || null,
      confidence: input.confidence ?? null,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      typeId: input.typeId,
      title: input.title.trim(),
      summary: input.summary?.trim() || '',
      aliasesJson: asJsonValue(normalizeStringArray(input.aliases)),
      tagsJson: asJsonValue(normalizeStringArray(input.tags)),
      attributesJson: asJsonValue(input.attributes ?? {}),
      source: input.source?.trim() || null,
      confidence: input.confidence ?? null,
      updatedAt: now,
    },
  });

  await touchKnowledgeMetadata(now);

  const relations = await prisma.knowledgeRelationRecord.findMany({
    where: {
      userId: DEFAULT_USER_ID,
      subjectId: entity.id,
    },
  });

  return {
    id: entity.id,
    typeId: entity.typeId,
    title: entity.title,
    summary: entity.summary,
    aliases: toStringArray(entity.aliasesJson),
    tags: toStringArray(entity.tagsJson),
    attributes: toRecord(entity.attributesJson),
    relations: relations.map((relation) => ({
      predicateId: relation.predicateId,
      targetId: relation.targetId,
      source: relation.source ?? undefined,
      confidence: relation.confidence ?? undefined,
    })),
    source: entity.source ?? undefined,
    confidence: entity.confidence ?? undefined,
    createdAt: toTimestamp(entity.createdAt),
    updatedAt: existing ? nowTs : toTimestamp(entity.createdAt),
  };
}

export async function deleteKnowledgeEntityStructured(id: string): Promise<boolean> {
  const existing = await prisma.knowledgeEntityRecord.findFirst({
    where: {
      userId: DEFAULT_USER_ID,
      id,
    },
  });

  if (!existing) {
    return false;
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const relatedAssertions = await tx.knowledgeAssertionRecord.findMany({
      where: {
        userId: DEFAULT_USER_ID,
        OR: [{ subjectId: id }, { objectId: id }],
      },
      select: { id: true },
    });

    if (relatedAssertions.length > 0) {
      await tx.knowledgeAssertionEvidenceLink.deleteMany({
        where: {
          userId: DEFAULT_USER_ID,
          assertionId: {
            in: relatedAssertions.map((item) => item.id),
          },
        },
      });
    }

    await tx.knowledgeAssertionRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        OR: [{ subjectId: id }, { objectId: id }],
      },
    });

    await tx.knowledgeRelationRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        OR: [{ subjectId: id }, { targetId: id }],
      },
    });

    await tx.knowledgeDocumentEntityLink.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        entityId: id,
      },
    });

    await tx.knowledgeEntityRecord.delete({
      where: { id },
    });

    await touchKnowledgeMetadata(now, tx);
  });

  return true;
}

export async function upsertKnowledgeDocumentStructured(
  input: UpsertKnowledgeDocumentInput
): Promise<KnowledgeDocumentRecordShape> {
  await ensureKnowledgeBase();
  const now = new Date();
  const ids = new Set(
    (
      await prisma.knowledgeDocumentRecord.findMany({
        where: { userId: DEFAULT_USER_ID },
        select: { id: true },
      })
    ).map((item) => item.id)
  );
  const existing = input.id
    ? await prisma.knowledgeDocumentRecord.findFirst({
        where: {
          userId: DEFAULT_USER_ID,
          id: input.id,
        },
      })
    : null;
  const validEntityIds = new Set(
    (
      await prisma.knowledgeEntityRecord.findMany({
        where: { userId: DEFAULT_USER_ID },
        select: { id: true },
      })
    ).map((item) => item.id)
  );
  const id = existing?.id || input.id || createUniqueId('doc', input.title, ids);
  const entityIds = normalizeStringArray(input.entityIds).filter((entityId) => validEntityIds.has(entityId));

  const document = await prisma.$transaction(async (tx) => {
    const saved = await tx.knowledgeDocumentRecord.upsert({
      where: { id },
      create: {
        id,
        userId: DEFAULT_USER_ID,
        title: input.title.trim(),
        summary: input.summary?.trim() || '',
        content: input.content?.trim() || '',
        tagsJson: asJsonValue(normalizeStringArray(input.tags)),
        source: input.source?.trim() || null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        title: input.title.trim(),
        summary: input.summary?.trim() || '',
        content: input.content?.trim() || '',
        tagsJson: asJsonValue(normalizeStringArray(input.tags)),
        source: input.source?.trim() || null,
        updatedAt: now,
      },
    });

    await tx.knowledgeDocumentEntityLink.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        documentId: id,
      },
    });

    if (entityIds.length > 0) {
      await tx.knowledgeDocumentEntityLink.createMany({
        data: entityIds.map((entityId) => ({
          userId: DEFAULT_USER_ID,
          documentId: id,
          entityId,
        })),
      });
    }

    await touchKnowledgeMetadata(now, tx);
    return saved;
  });

  return {
    id: document.id,
    title: document.title,
    summary: document.summary,
    content: document.content,
    tags: toStringArray(document.tagsJson),
    entityIds,
    source: document.source ?? undefined,
    createdAt: toTimestamp(document.createdAt),
    updatedAt: toTimestamp(document.updatedAt),
  };
}

export async function deleteKnowledgeDocumentStructured(id: string): Promise<boolean> {
  const existing = await prisma.knowledgeDocumentRecord.findFirst({
    where: {
      userId: DEFAULT_USER_ID,
      id,
    },
  });

  if (!existing) {
    return false;
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const relatedAssertions = await tx.knowledgeAssertionRecord.findMany({
      where: {
        userId: DEFAULT_USER_ID,
        objectId: id,
      },
      select: { id: true },
    });

    if (relatedAssertions.length > 0) {
      await tx.knowledgeAssertionEvidenceLink.deleteMany({
        where: {
          userId: DEFAULT_USER_ID,
          assertionId: {
            in: relatedAssertions.map((item) => item.id),
          },
        },
      });
    }

    await tx.knowledgeAssertionRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        objectId: id,
      },
    });

    await tx.knowledgeAssertionEvidenceLink.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        documentId: id,
      },
    });

    await tx.knowledgeDocumentEntityLink.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        documentId: id,
      },
    });

    await tx.knowledgeDocumentRecord.delete({
      where: { id },
    });

    await touchKnowledgeMetadata(now, tx);
  });

  return true;
}

export async function upsertKnowledgeAssertionStructured(
  input: UpsertKnowledgeAssertionInput
): Promise<KnowledgeAssertionRecordShape> {
  await ensureKnowledgeBase();
  const now = new Date();
  const ids = new Set(
    (
      await prisma.knowledgeAssertionRecord.findMany({
        where: { userId: DEFAULT_USER_ID },
        select: { id: true },
      })
    ).map((item) => item.id)
  );
  const existing = input.id
    ? await prisma.knowledgeAssertionRecord.findFirst({
        where: {
          userId: DEFAULT_USER_ID,
          id: input.id,
        },
      })
    : null;
  const validSubjectIds = new Set(
    (
      await prisma.knowledgeEntityRecord.findMany({
        where: { userId: DEFAULT_USER_ID },
        select: { id: true },
      })
    ).map((item) => item.id)
  );
  const validObjectIds = new Set([
    ...(
      await prisma.knowledgeEntityRecord.findMany({
        where: { userId: DEFAULT_USER_ID },
        select: { id: true },
      })
    ).map((item) => item.id),
    ...(
      await prisma.knowledgeDocumentRecord.findMany({
        where: { userId: DEFAULT_USER_ID },
        select: { id: true },
      })
    ).map((item) => item.id),
  ]);
  const validEvidenceIds = new Set(
    (
      await prisma.knowledgeDocumentRecord.findMany({
        where: { userId: DEFAULT_USER_ID },
        select: { id: true },
      })
    ).map((item) => item.id)
  );

  if (!validSubjectIds.has(input.subjectId)) {
    throw new Error('断言主体必须是已存在的实体。');
  }

  if (input.objectId && !validObjectIds.has(input.objectId)) {
    throw new Error('断言目标不存在。');
  }

  const nextValue =
    input.value === undefined
      ? undefined
      : typeof input.value === 'string'
        ? input.value.trim()
        : input.value;

  if (!input.objectId && (nextValue === undefined || nextValue === '')) {
    throw new Error('断言需要至少提供目标对象或标量值。');
  }

  const id =
    existing?.id ||
    input.id ||
    createUniqueId(
      'assertion',
      `${input.subjectId}-${input.predicateId}-${input.objectId || String(nextValue)}`,
      ids
    );
  const evidenceDocumentIds = normalizeStringArray(input.evidenceDocumentIds).filter((docId) =>
    validEvidenceIds.has(docId)
  );

  const assertion = await prisma.$transaction(async (tx) => {
    const saved = await tx.knowledgeAssertionRecord.upsert({
      where: { id },
      create: {
        id,
        userId: DEFAULT_USER_ID,
        subjectId: input.subjectId,
        predicateId: input.predicateId,
        objectId: input.objectId ?? null,
        scalarValueJson:
          nextValue === undefined
            ? Prisma.DbNull
            : asJsonValue(nextValue),
        source: input.source?.trim() || null,
        confidence: input.confidence ?? null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        subjectId: input.subjectId,
        predicateId: input.predicateId,
        objectId: input.objectId ?? null,
        scalarValueJson:
          nextValue === undefined
            ? Prisma.DbNull
            : asJsonValue(nextValue),
        source: input.source?.trim() || null,
        confidence: input.confidence ?? null,
        updatedAt: now,
      },
    });

    await tx.knowledgeAssertionEvidenceLink.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        assertionId: id,
      },
    });

    if (evidenceDocumentIds.length > 0) {
      await tx.knowledgeAssertionEvidenceLink.createMany({
        data: evidenceDocumentIds.map((documentId) => ({
          userId: DEFAULT_USER_ID,
          assertionId: id,
          documentId,
        })),
      });
    }

    await touchKnowledgeMetadata(now, tx);
    return saved;
  });

  return {
    id: assertion.id,
    subjectId: assertion.subjectId,
    predicateId: assertion.predicateId,
    objectId: assertion.objectId ?? undefined,
    value: nextValue === '' ? undefined : nextValue,
    evidenceDocumentIds,
    source: assertion.source ?? undefined,
    confidence: assertion.confidence ?? undefined,
    createdAt: toTimestamp(assertion.createdAt),
    updatedAt: toTimestamp(assertion.updatedAt),
  };
}

export async function deleteKnowledgeAssertionStructured(id: string): Promise<boolean> {
  const existing = await prisma.knowledgeAssertionRecord.findFirst({
    where: {
      userId: DEFAULT_USER_ID,
      id,
    },
  });

  if (!existing) {
    return false;
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.knowledgeAssertionEvidenceLink.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        assertionId: id,
      },
    });

    await tx.knowledgeAssertionRecord.delete({
      where: { id },
    });

    await touchKnowledgeMetadata(now, tx);
  });

  return true;
}

export async function createKnowledgeRelationStructured(
  input: CreateKnowledgeRelationInput
): Promise<KnowledgeAssertionRecordShape> {
  await ensureKnowledgeBase();
  const now = new Date();
  const subject = await prisma.knowledgeEntityRecord.findFirst({
    where: {
      userId: DEFAULT_USER_ID,
      id: input.subjectId,
    },
  });
  const target = await prisma.knowledgeEntityRecord.findFirst({
    where: {
      userId: DEFAULT_USER_ID,
      id: input.targetId,
    },
  });

  if (!subject) {
    throw new Error('关系起点实体不存在。');
  }

  if (!target) {
    throw new Error('关系目标实体不存在。');
  }

  const existingAssertion = await prisma.knowledgeAssertionRecord.findFirst({
    where: {
      userId: DEFAULT_USER_ID,
      subjectId: input.subjectId,
      predicateId: input.predicateId,
      objectId: input.targetId,
    },
  });

  const assertionId =
    existingAssertion?.id ||
    createUniqueId(
      'assertion',
      `${input.subjectId}-${input.predicateId}-${input.targetId}`,
      new Set(
        (
          await prisma.knowledgeAssertionRecord.findMany({
            where: { userId: DEFAULT_USER_ID },
            select: { id: true },
          })
        ).map((item) => item.id)
      )
    );

  await prisma.$transaction(async (tx) => {
    await tx.knowledgeRelationRecord.upsert({
      where: {
        userId_subjectId_predicateId_targetId: {
          userId: DEFAULT_USER_ID,
          subjectId: input.subjectId,
          predicateId: input.predicateId,
          targetId: input.targetId,
        },
      },
      create: {
        userId: DEFAULT_USER_ID,
        subjectId: input.subjectId,
        predicateId: input.predicateId,
        targetId: input.targetId,
        source: input.source?.trim() || null,
        confidence: input.confidence ?? null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        source: input.source?.trim() || null,
        confidence: input.confidence ?? null,
        updatedAt: now,
      },
    });

    await tx.knowledgeAssertionRecord.upsert({
      where: { id: assertionId },
      create: {
        id: assertionId,
        userId: DEFAULT_USER_ID,
        subjectId: input.subjectId,
        predicateId: input.predicateId,
        objectId: input.targetId,
        scalarValueJson: Prisma.DbNull,
        source: input.source?.trim() || null,
        confidence: input.confidence ?? null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        source: input.source?.trim() || null,
        confidence: input.confidence ?? null,
        updatedAt: now,
      },
    });

    await touchKnowledgeMetadata(now, tx);
  });

  const assertion = await prisma.knowledgeAssertionRecord.findUniqueOrThrow({
    where: { id: assertionId },
  });
  const evidence = await prisma.knowledgeAssertionEvidenceLink.findMany({
    where: {
      userId: DEFAULT_USER_ID,
      assertionId,
    },
  });

  return {
    id: assertion.id,
    subjectId: assertion.subjectId,
    predicateId: assertion.predicateId,
    objectId: assertion.objectId ?? undefined,
    value: undefined,
    evidenceDocumentIds: evidence.map((item) => item.documentId),
    source: assertion.source ?? undefined,
    confidence: assertion.confidence ?? undefined,
    createdAt: toTimestamp(assertion.createdAt),
    updatedAt: toTimestamp(assertion.updatedAt),
  };
}

export async function deleteKnowledgeRelationStructured(
  subjectId: string,
  predicateId: string,
  targetId: string
): Promise<boolean> {
  const existing = await prisma.knowledgeRelationRecord.findFirst({
    where: {
      userId: DEFAULT_USER_ID,
      subjectId,
      predicateId,
      targetId,
    },
  });

  if (!existing) {
    return false;
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const relatedAssertions = await tx.knowledgeAssertionRecord.findMany({
      where: {
        userId: DEFAULT_USER_ID,
        subjectId,
        predicateId,
        objectId: targetId,
      },
      select: { id: true },
    });

    if (relatedAssertions.length > 0) {
      await tx.knowledgeAssertionEvidenceLink.deleteMany({
        where: {
          userId: DEFAULT_USER_ID,
          assertionId: {
            in: relatedAssertions.map((item) => item.id),
          },
        },
      });
    }

    await tx.knowledgeAssertionRecord.deleteMany({
      where: {
        userId: DEFAULT_USER_ID,
        subjectId,
        predicateId,
        objectId: targetId,
      },
    });

    await tx.knowledgeRelationRecord.delete({
      where: {
        userId_subjectId_predicateId_targetId: {
          userId: DEFAULT_USER_ID,
          subjectId,
          predicateId,
          targetId,
        },
      },
    });

    await touchKnowledgeMetadata(now, tx);
  });

  return true;
}
