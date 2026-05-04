import type { ProjectionOutboxEvent } from '@prisma/client';
import {
  createKnowledgeRelationRecord,
  deleteKnowledgeEntityRecord,
  upsertKnowledgeEntityRecord,
} from '../knowledge/service';
import { KNOWLEDGE_PROJECTION_TOPIC } from './outbox';

const WORKSPACE_ENTITY_ID = 'entity:workspace';
const TASK_CLASS_ID = 'class:task';
const FINANCE_CLASS_ID = 'class:finance-record';
const TASK_RELATION_ID = 'relation:linkedTask';
const FINANCE_RELATION_ID = 'relation:linkedFinanceRecord';
const TASK_KNOWLEDGE_SOURCE = 'task-module';
const FINANCE_KNOWLEDGE_SOURCE = 'finance-module';

type TaskProjectionPayload = {
  id: string;
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
};

type FinanceProjectionPayload = {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  category: string;
  date: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
};

function normalizeKnowledgeTags(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function buildTaskKnowledgeEntityId(taskId: string) {
  return `entity:task-${taskId}`;
}

function buildFinanceKnowledgeEntityId(recordId: string) {
  return `entity:finance-${recordId}`;
}

function buildTaskKnowledgeSummary(task: TaskProjectionPayload) {
  const parts = [task.completed ? '已完成' : '待处理', `优先级 ${task.priority}`];
  if (task.dueDate) {
    parts.push(`截止 ${task.dueDate}`);
  }
  return parts.join('，');
}

function buildFinanceKnowledgeSummary(record: FinanceProjectionPayload) {
  const typeLabel = record.type === 'income' ? '收入' : '支出';
  const parts = [`${typeLabel} ${record.amount} 元`, `分类 ${record.category}`, `日期 ${record.date}`];
  if (record.model) {
    parts.push(`模型 ${record.model}`);
  }
  return parts.join('，');
}

async function upsertTaskKnowledgeProjection(task: TaskProjectionPayload) {
  const entityId = buildTaskKnowledgeEntityId(task.id);

  await upsertKnowledgeEntityRecord({
    id: entityId,
    typeId: TASK_CLASS_ID,
    title: task.title.trim(),
    summary: buildTaskKnowledgeSummary(task),
    tags: normalizeKnowledgeTags([
      'task',
      task.priority,
      task.completed ? 'completed' : 'pending',
    ]),
    attributes: {
      taskId: task.id,
      completed: task.completed,
      priority: task.priority,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      ...(task.dueDate ? { dueDate: task.dueDate } : {}),
      ...(task.notes ? { notes: task.notes } : {}),
    },
    source: TASK_KNOWLEDGE_SOURCE,
    confidence: 1,
  });

  await createKnowledgeRelationRecord({
    subjectId: WORKSPACE_ENTITY_ID,
    predicateId: TASK_RELATION_ID,
    targetId: entityId,
    source: TASK_KNOWLEDGE_SOURCE,
    confidence: 1,
  });
}

async function deleteTaskKnowledgeProjection(taskId: string) {
  await deleteKnowledgeEntityRecord(buildTaskKnowledgeEntityId(taskId));
}

async function upsertFinanceKnowledgeProjection(record: FinanceProjectionPayload) {
  const entityId = buildFinanceKnowledgeEntityId(record.id);
  const typeLabel = record.type === 'income' ? '收入' : '支出';

  await upsertKnowledgeEntityRecord({
    id: entityId,
    typeId: FINANCE_CLASS_ID,
    title: `${typeLabel} ${record.description.trim() || record.category}`,
    summary: buildFinanceKnowledgeSummary(record),
    tags: normalizeKnowledgeTags(['finance', record.type, record.category]),
    attributes: {
      financeRecordId: record.id,
      type: record.type,
      amount: record.amount,
      category: record.category,
      description: record.description,
      date: record.date,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.model ? { model: record.model } : {}),
    },
    source: FINANCE_KNOWLEDGE_SOURCE,
    confidence: 1,
  });

  await createKnowledgeRelationRecord({
    subjectId: WORKSPACE_ENTITY_ID,
    predicateId: FINANCE_RELATION_ID,
    targetId: entityId,
    source: FINANCE_KNOWLEDGE_SOURCE,
    confidence: 1,
  });
}

async function deleteFinanceKnowledgeProjection(recordId: string) {
  await deleteKnowledgeEntityRecord(buildFinanceKnowledgeEntityId(recordId));
}

export async function processKnowledgeProjectionEvent(event: ProjectionOutboxEvent) {
  if (event.topic !== KNOWLEDGE_PROJECTION_TOPIC) {
    return;
  }

  if (event.aggregateType === 'task') {
    if (event.operation === 'delete') {
      await deleteTaskKnowledgeProjection(event.aggregateId);
      return;
    }

    await upsertTaskKnowledgeProjection(event.payloadJson as unknown as TaskProjectionPayload);
    return;
  }

  if (event.aggregateType === 'finance-record') {
    if (event.operation === 'delete') {
      await deleteFinanceKnowledgeProjection(event.aggregateId);
      return;
    }

    await upsertFinanceKnowledgeProjection(event.payloadJson as unknown as FinanceProjectionPayload);
  }
}
