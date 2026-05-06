import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  BookOpen,
  Bug,
  ChevronDown,
  Clock3,
  Database,
  FileText,
  Filter,
  GitBranchPlus,
  Link2,
  Network,
  PencilLine,
  Plus,
  Search,
  Shapes,
  Sparkles,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Card, EmptyState } from '../../components/ui';
import { fetchWithAuth } from '../../lib/auth';
import {
  createKnowledgeRelation,
  deleteOntologyClass,
  deleteOntologyRelation,
  deleteKnowledgeAssertion,
  deleteKnowledgeDocument,
  deleteKnowledgeEntity,
  deleteKnowledgeRelation,
  getKnowledgeDataset,
  getKnowledgeDocumentById,
  getKnowledgeEntityById,
  getKnowledgeOverview,
  getKnowledgeRelatedById,
  KnowledgeAssertion,
  KnowledgeDataset,
  KnowledgeDocument,
  KnowledgeEntity,
  KnowledgeOverview,
  KnowledgeSearchHit,
  OntologyClass,
  OntologyRelation,
  rebuildKnowledgeProjections,
  searchKnowledgeRemote,
  subscribeKnowledge,
  upsertOntologyClass,
  upsertOntologyRelation,
  upsertKnowledgeAssertion,
  upsertKnowledgeDocument,
  upsertKnowledgeEntity,
} from '../../kb';

type SelectedHit = Pick<KnowledgeSearchHit, 'kind' | 'id'>;
type KnowledgeViewMode = 'browse' | 'manage' | 'advanced';

type FeedbackState =
  | {
      type: 'success' | 'error';
      message: string;
    }
  | null;

interface DeleteDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

interface EntityFormState {
  typeId: string;
  title: string;
  summary: string;
  aliases: string;
  tags: string;
  attributesText: string;
  source: string;
  confidence: string;
}

interface DocumentFormState {
  title: string;
  summary: string;
  content: string;
  tags: string;
  entityIds: string[];
  source: string;
}

interface RelationFormState {
  subjectId: string;
  predicateId: string;
  targetId: string;
  source: string;
  confidence: string;
}

interface AssertionFormState {
  subjectId: string;
  predicateId: string;
  objectId: string;
  value: string;
  evidenceDocumentIds: string[];
  source: string;
  confidence: string;
}

interface GuidedEntityFormState {
  title: string;
  summary: string;
  tags: string;
  source: string;
}

interface GuidedDocumentFormState {
  title: string;
  summary: string;
  content: string;
  tags: string;
  source: string;
  entityIds: string[];
}

interface OntologyClassFormState {
  id: string;
  label: string;
  description: string;
  parentIds: string;
}

interface OntologyRelationFormState {
  id: string;
  label: string;
  description: string;
  inverseId: string;
  symmetric: boolean;
  transitive: boolean;
}

interface DetailMetaItem {
  label: string;
  value: string;
}

interface KnowledgeSpotlightItem {
  id: string;
  title: string;
  summary: string;
  kind: 'entity' | 'document';
  badge: string;
  updatedAt: number;
}

type KnowledgeCreateIntent = 'project-note' | 'source-document' | 'business-note' | 'structure-link';

interface ServerKnowledgeSnapshotSummary {
  updatedAt: number;
  entityCount: number;
  documentCount: number;
  assertionCount: number;
  classCount: number;
  relationCount: number;
}

function getCreateIntentLabel(intent: KnowledgeCreateIntent | null): string {
  switch (intent) {
    case 'project-note':
      return '项目知识';
    case 'source-document':
      return '说明文档';
    case 'business-note':
      return '业务备注';
    case 'structure-link':
      return '结构关联';
    default:
      return '知识内容';
  }
}

function getNodeKindLabel(kind: 'entity' | 'document', mode: KnowledgeViewMode): string {
  if (kind === 'document') {
    return mode === 'advanced' ? '文档' : '来源文档';
  }

  return mode === 'advanced' ? '实体' : '知识条目';
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) {
    return '未记录';
  }

  return new Date(timestamp).toLocaleString('zh-CN');
}

function parseListInput(input: string): string[] {
  return input
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleStringInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function stringifyAttributes(entity?: KnowledgeEntity): string {
  if (!entity || Object.keys(entity.attributes).length === 0) {
    return '{}';
  }

  return JSON.stringify(entity.attributes, null, 2);
}

function createEntityFormState(
  entity: KnowledgeEntity | null,
  fallbackTypeId: string
): EntityFormState {
  return {
    typeId: entity?.typeId || fallbackTypeId,
    title: entity?.title || '',
    summary: entity?.summary || '',
    aliases: entity?.aliases.join(', ') || '',
    tags: entity?.tags.join(', ') || '',
    attributesText: stringifyAttributes(entity || undefined),
    source: entity?.source || '',
    confidence: entity?.confidence !== undefined ? String(entity.confidence) : '',
  };
}

function createDocumentFormState(
  document: KnowledgeDocument | null,
  defaultEntityIds: string[] = []
): DocumentFormState {
  return {
    title: document?.title || '',
    summary: document?.summary || '',
    content: document?.content || '',
    tags: document?.tags.join(', ') || '',
    entityIds: document?.entityIds || defaultEntityIds,
    source: document?.source || '',
  };
}

function createRelationFormState(
  subjectId: string,
  predicateId: string,
  targetId: string
): RelationFormState {
  return {
    subjectId,
    predicateId,
    targetId,
    source: '',
    confidence: '',
  };
}

function createAssertionFormState(
  assertion: KnowledgeAssertion | null,
  defaults: Partial<AssertionFormState> = {}
): AssertionFormState {
  return {
    subjectId: assertion?.subjectId || defaults.subjectId || '',
    predicateId: assertion?.predicateId || defaults.predicateId || '',
    objectId: assertion?.objectId || defaults.objectId || '',
    value:
      assertion?.value === null
        ? 'null'
        : assertion?.value !== undefined
          ? String(assertion.value)
          : defaults.value || '',
    evidenceDocumentIds: assertion?.evidenceDocumentIds || defaults.evidenceDocumentIds || [],
    source: assertion?.source || defaults.source || '',
    confidence:
      assertion?.confidence !== undefined
        ? String(assertion.confidence)
        : defaults.confidence || '',
  };
}

function createGuidedEntityFormState(): GuidedEntityFormState {
  return {
    title: '',
    summary: '',
    tags: '',
    source: '',
  };
}

function createGuidedDocumentFormState(defaultEntityIds: string[] = []): GuidedDocumentFormState {
  return {
    title: '',
    summary: '',
    content: '',
    tags: '',
    source: '',
    entityIds: defaultEntityIds,
  };
}

function createOntologyClassFormState(item: OntologyClass | null): OntologyClassFormState {
  return {
    id: item?.id || '',
    label: item?.label || '',
    description: item?.description || '',
    parentIds: item?.parentIds.join(', ') || '',
  };
}

function createOntologyRelationFormState(item: OntologyRelation | null): OntologyRelationFormState {
  return {
    id: item?.id || '',
    label: item?.label || '',
    description: item?.description || '',
    inverseId: item?.inverseId || '',
    symmetric: Boolean(item?.symmetric),
    transitive: Boolean(item?.transitive),
  };
}

function isOntologyIdLike(value: string): boolean {
  return /^[a-z0-9]+:[a-z0-9-]+$/i.test(value.trim());
}

function parseConfidence(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('置信度必须是 0 到 1 之间的数字。');
  }

  return parsed;
}

function parseAttributes(attributesText: string): KnowledgeEntity['attributes'] {
  const normalized = attributesText.trim();
  if (!normalized) {
    return {};
  }

  const parsed = JSON.parse(normalized) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('属性必须是一个 JSON 对象。');
  }

  return parsed as KnowledgeEntity['attributes'];
}

function parseAssertionValue(value: string): KnowledgeAssertion['value'] | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'null') {
    return null;
  }

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  const numberValue = Number(normalized);
  if (!Number.isNaN(numberValue) && normalized !== '') {
    return numberValue;
  }

  return normalized;
}

function resolveKnowledgeNodeLabel(dataset: KnowledgeDataset, id?: string): string {
  if (!id) {
    return '未指定';
  }

  const entity = dataset.entities.find((item) => item.id === id);
  if (entity) {
    return entity.title;
  }

  const document = dataset.documents.find((item) => item.id === id);
  if (document) {
    return document.title;
  }

  return id;
}

function isTaskMappedEntity(entity: KnowledgeEntity): boolean {
  return entity.source === 'task-module' || entity.typeId === 'class:task';
}

function isFinanceMappedEntity(entity: KnowledgeEntity): boolean {
  return entity.source === 'finance-module' || entity.typeId === 'class:finance-record';
}

function getEntityOriginMeta(entity: KnowledgeEntity): {
  label: string;
  tone: 'primary' | 'success' | 'warning';
  description: string;
} {
  if (isTaskMappedEntity(entity)) {
    return {
      label: '系统生成 / 任务映射',
      tone: 'warning',
      description: '来自任务模块的自动映射知识条目。',
    };
  }

  if (isFinanceMappedEntity(entity)) {
    return {
      label: '系统生成 / 财务映射',
      tone: 'info' as never,
      description: '来自财务模块的自动映射知识条目。',
    };
  }

  return {
    label: '人工维护',
    tone: 'primary',
    description: '由知识库页面或智能体工具补录的知识条目。',
  };
}

function getEntityOriginBadgeClass(entity: KnowledgeEntity): string {
  if (isTaskMappedEntity(entity)) {
    return 'badge-warning';
  }
  if (isFinanceMappedEntity(entity)) {
    return 'badge-info';
  }
  return 'badge-primary';
}

function getEntityMetaItems(entity: KnowledgeEntity): DetailMetaItem[] {
  if (isTaskMappedEntity(entity)) {
    return [
      { label: '任务状态', value: entity.attributes.completed ? '已完成' : '待处理' },
      { label: '优先级', value: String(entity.attributes.priority ?? '未记录') },
      { label: '截止日期', value: String(entity.attributes.dueDate ?? '未设置') },
      { label: '任务 ID', value: String(entity.attributes.taskId ?? entity.id) },
    ];
  }

  if (isFinanceMappedEntity(entity)) {
    return [
      { label: '记录类型', value: entity.attributes.type === 'income' ? '收入' : '支出' },
      { label: '金额', value: `${String(entity.attributes.amount ?? '未记录')} 元` },
      { label: '分类', value: String(entity.attributes.category ?? '未记录') },
      { label: '日期', value: String(entity.attributes.date ?? '未记录') },
    ];
  }

  return [
    { label: '知识类型', value: entity.typeId },
    { label: '来源', value: entity.source || '未记录' },
  ];
}

function getEntityLinkedDocuments(dataset: KnowledgeDataset, entityId: string): KnowledgeDocument[] {
  return dataset.documents
    .filter((document) => document.entityIds.includes(entityId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function getEntityAssertions(dataset: KnowledgeDataset, entityId: string): KnowledgeAssertion[] {
  return dataset.assertions
    .filter((assertion) => assertion.subjectId === entityId || assertion.objectId === entityId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function getDocumentAssertions(dataset: KnowledgeDataset, documentId: string): KnowledgeAssertion[] {
  return dataset.assertions
    .filter(
      (assertion) =>
        assertion.objectId === documentId || assertion.evidenceDocumentIds.includes(documentId)
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function KnowledgeOverviewCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: 'primary' | 'success' | 'warning' | 'info';
}) {
  const toneMap = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${toneMap[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="text-3xl font-semibold text-text-primary font-mono">{value}</div>
      <div className="text-sm text-text-secondary mt-1">{label}</div>
    </Card>
  );
}

function ViewModeButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-4 text-left transition-all ${
        active
          ? 'border-primary bg-primary/10 shadow-[0_8px_24px_rgba(37,99,235,0.15)]'
          : 'border-border-primary bg-bg-card hover:border-primary/30 hover:bg-primary/5'
      }`}
    >
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="text-xs text-text-secondary mt-1 leading-5">{description}</div>
    </button>
  );
}

function KnowledgeCreateGuideModal({
  open,
  canCreateStructureLink,
  onClose,
  onSelect,
}: {
  open: boolean;
  canCreateStructureLink: boolean;
  onClose: () => void;
  onSelect: (intent: KnowledgeCreateIntent) => void;
}) {
  if (!open) {
    return null;
  }

  const options: Array<{
    id: KnowledgeCreateIntent;
    title: string;
    description: string;
    enabled: boolean;
  }> = [
    {
      id: 'project-note',
      title: '补充项目知识',
      description: '新增一个知识条目，用于记录项目概念、规则、模块说明或长期背景信息。',
      enabled: true,
    },
    {
      id: 'source-document',
      title: '补充说明文档',
      description: '新增一份来源文档、会议纪要或规范片段，并挂接到相关知识条目。',
      enabled: true,
    },
    {
      id: 'business-note',
      title: '补充业务备注',
      description: '围绕当前任务、财务或业务对象补充摘要、上下文和后续说明。',
      enabled: true,
    },
    {
      id: 'structure-link',
      title: '补充结构关联',
      description: '在已有知识条目之间建立结构化关联，适合维护模式或高级模式下使用。',
      enabled: canCreateStructureLink,
    },
  ];

  return (
    <ModalShell
      title="补充知识"
      description="先选择你要补充的内容类型，再进入对应表单，避免直接暴露图谱术语。"
      onClose={onClose}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={!option.enabled}
            onClick={() => option.enabled && onSelect(option.id)}
            className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
              option.enabled
                ? 'border-border-primary bg-bg-secondary hover:border-primary/30 hover:bg-primary/5'
                : 'border-border-primary bg-bg-card opacity-50 cursor-not-allowed'
            }`}
          >
            <div className="text-sm font-semibold text-text-primary">{option.title}</div>
            <div className="text-xs text-text-secondary mt-2 leading-5">{option.description}</div>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

function GuidedEntityCreateModal({
  open,
  intent,
  form,
  error,
  saving,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  intent: 'project-note' | 'business-note';
  form: GuidedEntityFormState;
  error: string;
  saving: boolean;
  onClose: () => void;
  onChange: (patch: Partial<GuidedEntityFormState>) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) {
    return null;
  }

  const isBusinessNote = intent === 'business-note';

  return (
    <ModalShell
      title={isBusinessNote ? '新增业务备注' : '新增项目知识'}
      description={isBusinessNote ? '快速补充业务背景、处理说明和备注。' : '快速补充项目概念、规则、模块说明等长期知识。'}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">标题</label>
          <input
            value={form.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder={isBusinessNote ? '例如：任务延期原因说明' : '例如：知识库页面收敛策略'}
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">摘要</label>
          <textarea
            value={form.summary}
            onChange={(event) => onChange({ summary: event.target.value })}
            placeholder={isBusinessNote ? '概括当前业务背景、限制或后续动作。' : '概括该知识条目的核心含义和使用场景。'}
            className="input min-h-[120px] py-3"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">标签</label>
            <input
              value={form.tags}
              onChange={(event) => onChange({ tags: event.target.value })}
              placeholder={isBusinessNote ? '例如：task-note, handoff' : '多个值用逗号分隔'}
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">来源</label>
            <input
              value={form.source}
              onChange={(event) => onChange({ source: event.target.value })}
              placeholder={isBusinessNote ? '例如：当日处理记录' : '例如：交接文档、设计稿'}
              className="input"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={saving} icon={<PencilLine className="w-4 h-4" />}>
            创建{isBusinessNote ? '备注' : '知识'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function GuidedDocumentCreateModal({
  open,
  intent,
  form,
  error,
  saving,
  entityOptions,
  onClose,
  onChange,
  onToggleEntity,
  onSubmit,
}: {
  open: boolean;
  intent: 'source-document' | 'business-note';
  form: GuidedDocumentFormState;
  error: string;
  saving: boolean;
  entityOptions: KnowledgeEntity[];
  onClose: () => void;
  onChange: (patch: Partial<GuidedDocumentFormState>) => void;
  onToggleEntity: (entityId: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) {
    return null;
  }

  const isBusinessNote = intent === 'business-note';

  return (
    <ModalShell
      title={isBusinessNote ? '新增业务备注' : '新增说明文档'}
      description={isBusinessNote ? '快速记录与当前业务对象相关的说明、背景和处理依据。' : '快速录入来源文档、会议纪要或规范片段。'}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">标题</label>
          <input
            value={form.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder={isBusinessNote ? '例如：当前财务记录补充说明' : '例如：需求讨论纪要'}
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">摘要</label>
          <textarea
            value={form.summary}
            onChange={(event) => onChange({ summary: event.target.value })}
            placeholder={isBusinessNote ? '概括业务背景、结论和处理方向。' : '概括文档主旨、用途和适用范围。'}
            className="input min-h-[96px] py-3"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">{isBusinessNote ? '备注内容' : '文档内容'}</label>
          <textarea
            value={form.content}
            onChange={(event) => onChange({ content: event.target.value })}
            placeholder={isBusinessNote ? '填写业务背景、判断依据、待办事项或补充说明。' : '粘贴文档正文、纪要摘要或关键片段。'}
            className="input min-h-[180px] py-3"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">标签</label>
            <input
              value={form.tags}
              onChange={(event) => onChange({ tags: event.target.value })}
              placeholder={isBusinessNote ? '例如：finance-note, review' : '多个值用逗号分隔'}
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">来源</label>
            <input
              value={form.source}
              onChange={(event) => onChange({ source: event.target.value })}
              placeholder={isBusinessNote ? '例如：处理记录、会话摘要' : '例如：需求文档、会议纪要'}
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-3">关联知识条目</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto rounded-xl border border-border-primary bg-bg-secondary p-3">
            {entityOptions.length === 0 ? (
              <div className="text-sm text-text-muted">暂无可选知识条目。</div>
            ) : (
              entityOptions.map((entity) => {
                const checked = form.entityIds.includes(entity.id);
                return (
                  <label
                    key={entity.id}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                      checked
                        ? 'border-primary bg-primary/8'
                        : 'border-border-primary bg-bg-card'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleEntity(entity.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary">{entity.title}</div>
                      <div className="text-xs text-text-muted mt-1">{entity.typeId}</div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={saving} icon={<FileText className="w-4 h-4" />}>
            创建{isBusinessNote ? '备注' : '文档'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function DebugDrawer({
  open,
  dataset,
  overview,
  viewMode,
  selectedEntity,
  selectedDocument,
  selectedTypeId,
  includeDocuments,
  searchQuery,
  mappedEntityCount,
  manualEntityCount,
  serverKnowledgeSnapshot,
  serverSnapshotError,
  loadingServerSnapshot,
  onClose,
}: {
  open: boolean;
  dataset: KnowledgeDataset;
  overview: KnowledgeOverview;
  viewMode: KnowledgeViewMode;
  selectedEntity?: KnowledgeEntity;
  selectedDocument?: KnowledgeDocument;
  selectedTypeId: string;
  includeDocuments: boolean;
  searchQuery: string;
  mappedEntityCount: number;
  manualEntityCount: number;
  serverKnowledgeSnapshot: ServerKnowledgeSnapshotSummary | null;
  serverSnapshotError: string;
  loadingServerSnapshot: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  const selectedNode = selectedEntity
    ? {
        kind: 'entity',
        id: selectedEntity.id,
        title: selectedEntity.title,
        source: selectedEntity.source || '未记录',
      }
    : selectedDocument
      ? {
          kind: 'document',
          id: selectedDocument.id,
          title: selectedDocument.title,
          source: selectedDocument.source || '未记录',
        }
      : null;
  const taskMappedEntities = dataset.entities.filter((entity) => isTaskMappedEntity(entity)).length;
  const financeMappedEntities = dataset.entities.filter((entity) => isFinanceMappedEntity(entity)).length;
  const selectedNodeJson = selectedEntity
    ? JSON.stringify(selectedEntity, null, 2)
    : selectedDocument
      ? JSON.stringify(selectedDocument, null, 2)
      : '';
  const datasetSnapshotJson = JSON.stringify(
    {
      viewMode,
      entityCount: dataset.entities.length,
      documentCount: dataset.documents.length,
      assertionCount: dataset.assertions.length,
      sampleEntityIds: dataset.entities.slice(0, 5).map((entity) => entity.id),
      sampleDocumentIds: dataset.documents.slice(0, 5).map((document) => document.id),
    },
    null,
    2
  );

  return (
    <ModalShell
      title="调试信息"
      description="用于查看当前知识结构、筛选条件和选中节点的内部状态，不参与日常浏览主流程。"
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
            <div className="text-xs text-text-muted mb-1">当前查询</div>
            <div className="text-sm text-text-primary break-words">{searchQuery || '空查询'}</div>
          </div>
          <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
            <div className="text-xs text-text-muted mb-1">筛选条件</div>
            <div className="text-sm text-text-primary">
              类型：{selectedTypeId} / {includeDocuments ? '含文档' : '仅实体'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
            <div className="text-xs text-text-muted mb-1">系统映射实体</div>
            <div className="text-lg font-semibold text-text-primary">{mappedEntityCount}</div>
          </div>
          <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
            <div className="text-xs text-text-muted mb-1">人工维护实体</div>
            <div className="text-lg font-semibold text-text-primary">{manualEntityCount}</div>
          </div>
          <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
            <div className="text-xs text-text-muted mb-1">最近更新时间</div>
            <div className="text-sm text-text-primary">{formatTimestamp(overview.lastUpdatedAt)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
            <div className="text-xs text-text-muted mb-1">当前模式</div>
            <div className="text-sm text-text-primary">{viewMode}</div>
          </div>
          <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
            <div className="text-xs text-text-muted mb-1">任务映射实体</div>
            <div className="text-sm text-text-primary">{taskMappedEntities}</div>
          </div>
          <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
            <div className="text-xs text-text-muted mb-1">财务映射实体</div>
            <div className="text-sm text-text-primary">{financeMappedEntities}</div>
          </div>
        </div>

        <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
          <div className="text-sm font-semibold text-text-primary mb-2">当前选中节点</div>
          {selectedNode ? (
            <div className="space-y-1 text-sm text-text-primary">
              <div>类型：{selectedNode.kind}</div>
              <div>ID：{selectedNode.id}</div>
              <div>标题：{selectedNode.title}</div>
              <div>来源：{selectedNode.source}</div>
            </div>
          ) : (
            <div className="text-sm text-text-muted">当前没有选中节点。</div>
          )}
        </div>

        <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
          <div className="text-sm font-semibold text-text-primary mb-2">知识结构总览</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm text-text-primary">
            <div>类：{dataset.ontology.classes.length}</div>
            <div>关系：{dataset.ontology.relations.length}</div>
            <div>实体：{dataset.entities.length}</div>
            <div>文档：{dataset.documents.length}</div>
            <div>断言：{dataset.assertions.length}</div>
          </div>
        </div>

        <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
          <div className="text-sm font-semibold text-text-primary mb-2">最近 5 个节点 ID</div>
          <div className="space-y-2 text-xs font-mono text-text-secondary">
            {[
              ...dataset.entities.slice(0, 3).map((entity) => entity.id),
              ...dataset.documents.slice(0, 2).map((document) => document.id),
            ].map((id) => (
              <div key={id} className="break-all">{id}</div>
            ))}
          </div>
        </div>

        <CollapsibleSection
          title="当前节点原始 JSON"
          description="用于快速查看选中节点的原始结构。"
        >
          {selectedNodeJson ? (
            <pre className="rounded-xl border border-border-primary bg-bg-card p-4 text-xs text-text-secondary overflow-x-auto whitespace-pre-wrap break-all">
              {selectedNodeJson}
            </pre>
          ) : (
            <div className="text-sm text-text-muted">当前没有可预览的节点。</div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="知识快照摘要 JSON"
          description="轻量调试视图，展示当前内存态的结构摘要。"
        >
          <pre className="rounded-xl border border-border-primary bg-bg-card p-4 text-xs text-text-secondary overflow-x-auto whitespace-pre-wrap break-all">
            {datasetSnapshotJson}
          </pre>
        </CollapsibleSection>

        <CollapsibleSection
          title="服务端知识快照"
          description="读取 /api/knowledge/dataset 的知识摘要，用于粗略对比当前内存态与服务端权威数据。"
        >
          {loadingServerSnapshot ? (
            <div className="text-sm text-text-muted">正在读取服务端知识快照...</div>
          ) : serverSnapshotError ? (
            <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              {serverSnapshotError}
            </div>
          ) : serverKnowledgeSnapshot ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm text-text-primary">
                <div>类：{serverKnowledgeSnapshot.classCount}</div>
                <div>关系：{serverKnowledgeSnapshot.relationCount}</div>
                <div>实体：{serverKnowledgeSnapshot.entityCount}</div>
                <div>文档：{serverKnowledgeSnapshot.documentCount}</div>
                <div>断言：{serverKnowledgeSnapshot.assertionCount}</div>
                <div>更新时间：{formatTimestamp(serverKnowledgeSnapshot.updatedAt)}</div>
              </div>
              <div className="rounded-xl border border-border-primary bg-bg-card px-4 py-3 text-sm text-text-primary">
                <div>内存实体差异：{dataset.entities.length - serverKnowledgeSnapshot.entityCount}</div>
                <div className="mt-1">内存文档差异：{dataset.documents.length - serverKnowledgeSnapshot.documentCount}</div>
                <div className="mt-1">内存断言差异：{dataset.assertions.length - serverKnowledgeSnapshot.assertionCount}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-text-muted">暂无服务端知识快照。</div>
          )}
        </CollapsibleSection>
      </div>
    </ModalShell>
  );
}

function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl border border-border-primary bg-bg-secondary overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-primary/5 transition-colors"
      >
        <div>
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          {description && <div className="text-xs text-text-secondary mt-1">{description}</div>}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ModalShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/55 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center">
        <motion.div
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.18 }}
          onClick={(event) => event.stopPropagation()}
          className="w-full max-w-3xl rounded-2xl border border-border-primary bg-bg-card shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border-primary px-6 py-5">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
              <p className="text-sm text-text-secondary mt-1">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-xl border border-border-primary bg-bg-secondary flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-6">{children}</div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function OntologyManagerModal({
  open,
  activeTab,
  classForm,
  relationForm,
  editingClass,
  editingRelation,
  error,
  saving,
  classes,
  relations,
  onClose,
  onTabChange,
  onClassFormChange,
  onRelationFormChange,
  onCreateClass,
  onEditClass,
  onDeleteClass,
  onFilterByClass,
  onSubmitClass,
  onCreateRelation,
  onEditRelation,
  onDeleteRelation,
  onFilterByRelation,
  onSubmitRelation,
}: {
  open: boolean;
  activeTab: 'classes' | 'relations';
  classForm: OntologyClassFormState;
  relationForm: OntologyRelationFormState;
  editingClass: OntologyClass | null;
  editingRelation: OntologyRelation | null;
  error: string;
  saving: boolean;
  classes: OntologyClass[];
  relations: OntologyRelation[];
  onClose: () => void;
  onTabChange: (tab: 'classes' | 'relations') => void;
  onClassFormChange: (patch: Partial<OntologyClassFormState>) => void;
  onRelationFormChange: (patch: Partial<OntologyRelationFormState>) => void;
  onCreateClass: () => void;
  onEditClass: (item: OntologyClass) => void;
  onDeleteClass: (item: OntologyClass) => void;
  onFilterByClass: (item: OntologyClass) => void;
  onSubmitClass: (event: React.FormEvent<HTMLFormElement>) => void;
  onCreateRelation: () => void;
  onEditRelation: (item: OntologyRelation) => void;
  onDeleteRelation: (item: OntologyRelation) => void;
  onFilterByRelation: (item: OntologyRelation) => void;
  onSubmitRelation: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) {
    return null;
  }

  const currentInverseOptions = relations.filter((item) => item.id !== relationForm.id);
  const parentOptions = classes.filter((item) => item.id !== classForm.id);

  return (
    <ModalShell
      title="Ontology 管理"
      description="维护知识库中的类与关系定义。当前为轻量管理模式，优先覆盖查看、补充、修正与删除。"
      onClose={onClose}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onTabChange('classes')}
            className={`rounded-xl border px-4 py-2 text-sm transition-colors ${
              activeTab === 'classes'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-primary/30 hover:bg-primary/5'
            }`}
          >
            类定义
          </button>
          <button
            type="button"
            onClick={() => onTabChange('relations')}
            className={`rounded-xl border px-4 py-2 text-sm transition-colors ${
              activeTab === 'relations'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-primary/30 hover:bg-primary/5'
            }`}
          >
            关系定义
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {activeTab === 'classes' ? (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">当前类定义</div>
                  <div className="text-xs text-text-muted mt-1">共 {classes.length} 个类，可用于实体类型筛选与建模。</div>
                </div>
                <Button variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={onCreateClass}>
                  新增类
                </Button>
              </div>

              <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                {classes.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-border-primary bg-bg-secondary px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary">{item.label}</div>
                        <div className="text-xs text-text-muted font-mono mt-1 break-all">{item.id}</div>
                        <div className="text-xs text-text-secondary mt-2 leading-5">
                          {item.description || '暂无描述。'}
                        </div>
                        <div className="text-[11px] text-text-muted mt-2">
                          父类：{item.parentIds.length > 0 ? item.parentIds.join(', ') : '无'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="secondary" onClick={() => onFilterByClass(item)}>
                          筛选
                        </Button>
                        <Button variant="ghost" onClick={() => onEditClass(item)}>
                          编辑
                        </Button>
                        <Button variant="danger" onClick={() => onDeleteClass(item)}>
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={onSubmitClass} className="rounded-2xl border border-border-primary bg-bg-secondary p-5 space-y-4">
              <div>
                <div className="text-base font-semibold text-text-primary">
                  {editingClass ? '编辑类定义' : '新增类定义'}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  类 ID 建议保持稳定；编辑时不允许修改现有 ID。
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">类 ID</label>
                <input
                  value={classForm.id}
                  onChange={(event) => onClassFormChange({ id: event.target.value })}
                  className="input"
                  placeholder="class:project"
                  disabled={Boolean(editingClass)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">名称</label>
                <input
                  value={classForm.label}
                  onChange={(event) => onClassFormChange({ label: event.target.value })}
                  className="input"
                  placeholder="项目"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">描述</label>
                <textarea
                  value={classForm.description}
                  onChange={(event) => onClassFormChange({ description: event.target.value })}
                  className="input min-h-[100px]"
                  placeholder="说明这个类用于描述什么对象。"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">父类 ID</label>
                <textarea
                  value={classForm.parentIds}
                  onChange={(event) => onClassFormChange({ parentIds: event.target.value })}
                  className="input min-h-[88px]"
                  placeholder="多个 ID 用逗号或换行分隔"
                />
                {parentOptions.length > 0 && (
                  <div className="text-xs text-text-muted mt-2">
                    可选父类：{parentOptions.map((item) => item.id).join(', ')}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={onCreateClass}>
                  重置
                </Button>
                <Button type="submit" loading={saving} icon={<Shapes className="w-4 h-4" />}>
                  {editingClass ? '保存类定义' : '创建类定义'}
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">当前关系定义</div>
                  <div className="text-xs text-text-muted mt-1">共 {relations.length} 个关系，可用于结构边与事实记录谓词。</div>
                </div>
                <Button variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={onCreateRelation}>
                  新增关系
                </Button>
              </div>

              <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                {relations.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-border-primary bg-bg-secondary px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary">{item.label}</div>
                        <div className="text-xs text-text-muted font-mono mt-1 break-all">{item.id}</div>
                        <div className="text-xs text-text-secondary mt-2 leading-5">
                          {item.description || '暂无描述。'}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-text-muted">
                          <span>inverse：{item.inverseId || '无'}</span>
                          <span>symmetric：{item.symmetric ? '是' : '否'}</span>
                          <span>transitive：{item.transitive ? '是' : '否'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="secondary" onClick={() => onFilterByRelation(item)}>
                          筛选
                        </Button>
                        <Button variant="ghost" onClick={() => onEditRelation(item)}>
                          编辑
                        </Button>
                        <Button variant="danger" onClick={() => onDeleteRelation(item)}>
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={onSubmitRelation} className="rounded-2xl border border-border-primary bg-bg-secondary p-5 space-y-4">
              <div>
                <div className="text-base font-semibold text-text-primary">
                  {editingRelation ? '编辑关系定义' : '新增关系定义'}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  关系 ID 建议保持稳定；inverse 关系可留空。
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">关系 ID</label>
                <input
                  value={relationForm.id}
                  onChange={(event) => onRelationFormChange({ id: event.target.value })}
                  className="input"
                  placeholder="rel:depends-on"
                  disabled={Boolean(editingRelation)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">名称</label>
                <input
                  value={relationForm.label}
                  onChange={(event) => onRelationFormChange({ label: event.target.value })}
                  className="input"
                  placeholder="依赖于"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">描述</label>
                <textarea
                  value={relationForm.description}
                  onChange={(event) => onRelationFormChange({ description: event.target.value })}
                  className="input min-h-[100px]"
                  placeholder="说明这个关系用于表达什么含义。"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Inverse 关系</label>
                <select
                  value={relationForm.inverseId}
                  onChange={(event) => onRelationFormChange({ inverseId: event.target.value })}
                  className="input"
                >
                  <option value="">无</option>
                  {currentInverseOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} ({item.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="rounded-xl border border-border-primary bg-bg-card px-4 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-text-primary">对称关系</span>
                  <input
                    type="checkbox"
                    checked={relationForm.symmetric}
                    onChange={(event) => onRelationFormChange({ symmetric: event.target.checked })}
                  />
                </label>
                <label className="rounded-xl border border-border-primary bg-bg-card px-4 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-text-primary">传递关系</span>
                  <input
                    type="checkbox"
                    checked={relationForm.transitive}
                    onChange={(event) => onRelationFormChange({ transitive: event.target.checked })}
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={onCreateRelation}>
                  重置
                </Button>
                <Button type="submit" loading={saving} icon={<Link2 className="w-4 h-4" />}>
                  {editingRelation ? '保存关系定义' : '创建关系定义'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function EntityEditorModal({
  open,
  editingEntity,
  intent,
  form,
  error,
  saving,
  classOptions,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  editingEntity: KnowledgeEntity | null;
  intent?: KnowledgeCreateIntent | null;
  form: EntityFormState;
  error: string;
  saving: boolean;
  classOptions: Array<{ id: string; label: string }>;
  onClose: () => void;
  onChange: (patch: Partial<EntityFormState>) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) {
    return null;
  }

  const isGuidedCreate = !editingEntity && Boolean(intent && intent !== 'structure-link');
  const showAdvancedFields = !isGuidedCreate;

  return (
    <ModalShell
      title={editingEntity ? '编辑知识条目（实体）' : '新增知识条目（实体）'}
      description={
        isGuidedCreate
          ? '当前为轻量录入视图，优先填写标题、摘要、标签与来源；复杂结构字段可后续在维护模式补充。'
          : '用于高级维护。可补录类型、标签、别名、来源与结构化属性；属性字段使用 JSON 对象。'
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {showAdvancedFields && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">条目类型（实体类型）</label>
              <select
                value={form.typeId}
                onChange={(event) => onChange({ typeId: event.target.value })}
                className="input"
                required
              >
                {classOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">置信度</label>
              <input
                value={form.confidence}
                onChange={(event) => onChange({ confidence: event.target.value })}
                placeholder="0 - 1，可选"
                className="input"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">标题</label>
          <input
            value={form.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="例如：知识库页面收敛方案"
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">摘要</label>
          <textarea
            value={form.summary}
            onChange={(event) => onChange({ summary: event.target.value })}
            placeholder="描述该知识条目的定位、作用或背景。"
            className="input min-h-[96px] py-3"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {showAdvancedFields && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">别名</label>
              <input
                value={form.aliases}
                onChange={(event) => onChange({ aliases: event.target.value })}
                placeholder="多个值用逗号分隔"
                className="input"
              />
            </div>
          )}

          <div className={showAdvancedFields ? '' : 'md:col-span-2'}>
            <label className="block text-sm font-medium text-text-secondary mb-2">标签</label>
            <input
              value={form.tags}
              onChange={(event) => onChange({ tags: event.target.value })}
              placeholder="多个值用逗号分隔"
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">来源</label>
          <input
            value={form.source}
            onChange={(event) => onChange({ source: event.target.value })}
            placeholder="例如：交接文档、设计稿、会议纪要"
            className="input"
          />
        </div>

        {showAdvancedFields && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">属性 JSON</label>
            <textarea
              value={form.attributesText}
              onChange={(event) => onChange({ attributesText: event.target.value })}
              className="input min-h-[180px] py-3 font-mono text-xs"
              spellCheck={false}
            />
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={saving} icon={<PencilLine className="w-4 h-4" />}>
            {editingEntity ? '保存知识条目' : '创建知识条目'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function RelationEditorModal({
  open,
  form,
  error,
  saving,
  relationOptions,
  entityOptions,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  form: RelationFormState;
  error: string;
  saving: boolean;
  relationOptions: Array<{ id: string; label: string }>;
  entityOptions: KnowledgeEntity[];
  onClose: () => void;
  onChange: (patch: Partial<RelationFormState>) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <ModalShell
      title="新建结构关联（关系）"
      description="结构关联会同步写入实体连边，并自动生成一条对应的事实记录（断言）。"
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">起点条目（实体）</label>
            <select
              value={form.subjectId}
              onChange={(event) => onChange({ subjectId: event.target.value })}
              className="input"
              required
            >
              {entityOptions.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">关系类型</label>
            <select
              value={form.predicateId}
              onChange={(event) => onChange({ predicateId: event.target.value })}
              className="input"
              required
            >
              {relationOptions.map((relation) => (
                <option key={relation.id} value={relation.id}>
                  {relation.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">目标条目（实体）</label>
            <select
              value={form.targetId}
              onChange={(event) => onChange({ targetId: event.target.value })}
              className="input"
              required
            >
              {entityOptions
                .filter((entity) => entity.id !== form.subjectId)
                .map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.title}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">置信度</label>
            <input
              value={form.confidence}
              onChange={(event) => onChange({ confidence: event.target.value })}
              placeholder="0 - 1，可选"
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">来源</label>
          <input
            value={form.source}
            onChange={(event) => onChange({ source: event.target.value })}
            placeholder="例如：交接文档、需求讨论、产品设计"
            className="input"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={saving} icon={<GitBranchPlus className="w-4 h-4" />}>
            保存结构关联
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function DeleteConfirmModal({
  open,
  title,
  description,
  deleting,
  onClose,
  onConfirm,
  confirmLabel,
}: {
  open: boolean;
  title: string;
  description: string;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  if (!open) {
    return null;
  }

  return (
    <ModalShell title={title} description={description} onClose={onClose}>
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="secondary" onClick={onClose} disabled={deleting}>
          取消
        </Button>
        <Button
          variant="danger"
          loading={deleting}
          icon={<Trash2 className="w-4 h-4" />}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </ModalShell>
  );
}

function DocumentEditorModal({
  open,
  editingDocument,
  intent,
  form,
  error,
  saving,
  entityOptions,
  onClose,
  onChange,
  onToggleEntity,
  onSubmit,
}: {
  open: boolean;
  editingDocument: KnowledgeDocument | null;
  intent?: KnowledgeCreateIntent | null;
  form: DocumentFormState;
  error: string;
  saving: boolean;
  entityOptions: KnowledgeEntity[];
  onClose: () => void;
  onChange: (patch: Partial<DocumentFormState>) => void;
  onToggleEntity: (entityId: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) {
    return null;
  }

  const isGuidedCreate = !editingDocument && Boolean(intent && intent !== 'structure-link');
  const isBusinessNote = intent === 'business-note';

  return (
    <ModalShell
      title={editingDocument ? '编辑来源文档' : '新增来源文档'}
      description={
        isGuidedCreate
          ? isBusinessNote
            ? '当前为业务备注录入视图，优先补充摘要、说明与关联对象。'
            : '当前为说明文档录入视图，优先补充标题、摘要、正文和关联对象。'
          : '录入来源文档、笔记或规范片段，并挂接关联知识条目（实体）。'
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">标题</label>
          <input
            value={form.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder={isBusinessNote ? '例如：任务上下文补充说明' : '例如：本体知识库实施方案'}
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">摘要</label>
          <textarea
            value={form.summary}
            onChange={(event) => onChange({ summary: event.target.value })}
            placeholder={isBusinessNote ? '概括这条备注要补充的业务背景。' : '概括该文档的主旨和用途。'}
            className="input min-h-[88px] py-3"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">正文内容</label>
          <textarea
            value={form.content}
            onChange={(event) => onChange({ content: event.target.value })}
            placeholder={isBusinessNote ? '填写业务说明、判断依据、后续动作或上下文片段。' : '粘贴文档正文、笔记摘要或关键片段。'}
            className="input min-h-[220px] py-3"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">标签</label>
            <input
              value={form.tags}
              onChange={(event) => onChange({ tags: event.target.value })}
              placeholder={isBusinessNote ? '例如：task-context, finance-note' : '多个值用逗号分隔'}
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">来源</label>
            <input
              value={form.source}
              onChange={(event) => onChange({ source: event.target.value })}
              placeholder="例如：需求文档、纪要、外部资料"
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-3">关联知识条目（实体）</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto rounded-xl border border-border-primary bg-bg-secondary p-3">
            {entityOptions.length === 0 ? (
              <div className="text-sm text-text-muted">暂无可选知识条目。</div>
            ) : (
              entityOptions.map((entity) => {
                const checked = form.entityIds.includes(entity.id);
                return (
                  <label
                    key={entity.id}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                      checked
                        ? 'border-primary bg-primary/8'
                        : 'border-border-primary bg-bg-card'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleEntity(entity.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary">{entity.title}</div>
                      <div className="text-xs text-text-muted mt-1">{entity.typeId}</div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={saving} icon={<FileText className="w-4 h-4" />}>
            {editingDocument ? '保存来源文档' : '创建来源文档'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function AssertionEditorModal({
  open,
  editingAssertion,
  form,
  error,
  saving,
  entityOptions,
  relationOptions,
  documentOptions,
  objectOptions,
  onClose,
  onChange,
  onToggleEvidence,
  onSubmit,
}: {
  open: boolean;
  editingAssertion: KnowledgeAssertion | null;
  form: AssertionFormState;
  error: string;
  saving: boolean;
  entityOptions: KnowledgeEntity[];
  relationOptions: Array<{ id: string; label: string }>;
  documentOptions: KnowledgeDocument[];
  objectOptions: Array<{ id: string; label: string; kind: 'entity' | 'document' }>;
  onClose: () => void;
  onChange: (patch: Partial<AssertionFormState>) => void;
  onToggleEvidence: (documentId: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <ModalShell
      title={editingAssertion ? '编辑事实记录（断言）' : '新增事实记录（断言）'}
      description="事实记录用于补充有来源、有置信度的内容，不等同于结构化关系连边。"
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">记录主体（实体）</label>
            <select
              value={form.subjectId}
              onChange={(event) => onChange({ subjectId: event.target.value })}
              className="input"
              required
            >
              {entityOptions.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">谓词</label>
            <select
              value={form.predicateId}
              onChange={(event) => onChange({ predicateId: event.target.value })}
              className="input"
              required
            >
              {relationOptions.map((relation) => (
                <option key={relation.id} value={relation.id}>
                  {relation.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">目标对象</label>
            <select
              value={form.objectId}
              onChange={(event) => onChange({ objectId: event.target.value })}
              className="input"
            >
              <option value="">不绑定对象，仅记录文本或数值</option>
              {objectOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} ({item.kind})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">置信度</label>
            <input
              value={form.confidence}
              onChange={(event) => onChange({ confidence: event.target.value })}
              placeholder="0 - 1，可选"
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">标量值</label>
          <input
            value={form.value}
            onChange={(event) => onChange({ value: event.target.value })}
            placeholder="可输入文本、数字、true/false 或 null"
            className="input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">来源</label>
          <input
            value={form.source}
            onChange={(event) => onChange({ source: event.target.value })}
            placeholder="例如：需求评审、设计文档、会议纪要"
            className="input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-3">证据文档（来源文档）</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto rounded-xl border border-border-primary bg-bg-secondary p-3">
            {documentOptions.length === 0 ? (
              <div className="text-sm text-text-muted">暂无可选文档。</div>
            ) : (
              documentOptions.map((document) => {
                const checked = form.evidenceDocumentIds.includes(document.id);
                return (
                  <label
                    key={document.id}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                      checked
                        ? 'border-primary bg-primary/8'
                        : 'border-border-primary bg-bg-card'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleEvidence(document.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary">{document.title}</div>
                      <div className="text-xs text-text-muted mt-1">{document.id}</div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={saving} icon={<Sparkles className="w-4 h-4" />}>
            {editingAssertion ? '保存事实记录' : '创建事实记录'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function AssertionCard({
  assertion,
  dataset,
  editable,
  onEdit,
  onDelete,
}: {
  assertion: KnowledgeAssertion;
  dataset: KnowledgeDataset;
  editable: boolean;
  onEdit: (assertion: KnowledgeAssertion) => void;
  onDelete: (assertion: KnowledgeAssertion) => void;
}) {
  const evidenceTitles = assertion.evidenceDocumentIds.map((id) => resolveKnowledgeNodeLabel(dataset, id));

  return (
    <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="badge badge-primary">{assertion.predicateId}</span>
            {assertion.confidence !== undefined && (
              <span className="badge badge-success">置信度 {assertion.confidence}</span>
            )}
          </div>
          <div className="text-sm text-text-primary break-words">
            {resolveKnowledgeNodeLabel(dataset, assertion.subjectId)}
            <span className="text-text-muted">{' -> '}</span>
            {assertion.objectId
              ? resolveKnowledgeNodeLabel(dataset, assertion.objectId)
              : assertion.value === null
                ? 'null'
                : String(assertion.value ?? '未设置')}
          </div>
          {assertion.source && (
            <div className="text-xs text-text-muted mt-2">来源：{assertion.source}</div>
          )}
          {evidenceTitles.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {evidenceTitles.map((title) => (
                <span key={`${assertion.id}-${title}`} className="badge badge-warning">
                  {title}
                </span>
              ))}
            </div>
          )}
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<PencilLine className="w-4 h-4" />}
              onClick={() => onEdit(assertion)}
            >
              编辑
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="w-4 h-4" />}
              onClick={() => onDelete(assertion)}
            >
              删除
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EntityDetail({
  entity,
  dataset,
  mode,
  onSelectEntity,
  onEditAssertion,
  onDeleteAssertion,
  onDeleteRelation,
}: {
  entity: KnowledgeEntity;
  dataset: KnowledgeDataset;
  mode: KnowledgeViewMode;
  onSelectEntity: (id: string) => void;
  onEditAssertion: (assertion: KnowledgeAssertion) => void;
  onDeleteAssertion: (assertion: KnowledgeAssertion) => void;
  onDeleteRelation: (
    subjectId: string,
    predicateId: string,
    targetId: string,
    targetLabel: string
  ) => void;
}) {
  const relatedEntities = getKnowledgeRelatedById(entity.id, 2);
  const linkedDocuments = getEntityLinkedDocuments(dataset, entity.id);
  const attributeEntries = Object.entries(entity.attributes);
  const assertions = getEntityAssertions(dataset, entity.id);
  const metaItems = getEntityMetaItems(entity);
  const originMeta = getEntityOriginMeta(entity);
  const showAdvanced = mode === 'advanced';
  const showManage = mode !== 'browse';

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="badge badge-primary">{entity.typeId}</span>
          <span className={`badge ${getEntityOriginBadgeClass(entity)}`}>{originMeta.label}</span>
          {entity.confidence !== undefined && (
            <span className="badge badge-success">置信度 {entity.confidence}</span>
          )}
        </div>
        <h2 className="text-2xl font-semibold text-text-primary">{entity.title}</h2>
        <p className="text-sm text-text-secondary mt-2">{entity.summary || '暂无摘要。'}</p>
        <p className="text-xs text-text-muted mt-3">{originMeta.description}</p>
      </div>

      {entity.aliases.length > 0 && (
        <div>
          <div className="section-title mb-3">
            <Tags className="section-title-icon" />
            别名
          </div>
          <div className="flex flex-wrap gap-2">
            {entity.aliases.map((alias) => (
              <span key={alias} className="badge badge-primary">
                {alias}
              </span>
            ))}
          </div>
        </div>
      )}

      {entity.tags.length > 0 && (
        <div>
          <div className="section-title mb-3">
            <Sparkles className="section-title-icon" />
            标签
          </div>
          <div className="flex flex-wrap gap-2">
            {entity.tags.map((tag) => (
              <span key={tag} className="badge badge-success">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="section-title mb-3">
          <Database className="section-title-icon" />
          关键信息
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {metaItems.map((item) => (
            <div key={item.label} className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
              <div className="text-xs text-text-muted mb-1">{item.label}</div>
              <div className="text-sm text-text-primary break-words">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="section-title mb-3">
          <BookOpen className="section-title-icon" />
          来源文档
        </div>
        {linkedDocuments.length === 0 ? (
          <div className="text-sm text-text-muted">暂无直接关联文档。</div>
        ) : (
          <div className="space-y-2">
            {linkedDocuments.map((document) => (
              <div
                key={document.id}
                className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3"
              >
                <div className="text-sm font-medium text-text-primary">{document.title}</div>
                <div className="text-xs text-text-secondary mt-1 line-clamp-2">
                  {document.summary || '暂无摘要。'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showManage && (
        <CollapsibleSection
          title={showAdvanced ? '扩展属性' : '补充字段'}
          description={
            showAdvanced
              ? '低频结构字段默认折叠，维护时再展开查看。'
              : '补充信息默认折叠，避免打断主阅读流程。'
          }
        >
          {attributeEntries.length === 0 ? (
            <div className="text-sm text-text-muted">
              {showAdvanced ? '暂无扩展属性。' : '暂无补充字段。'}
            </div>
          ) : (
            <div className="space-y-2">
              {attributeEntries.map(([key, value]) => (
                <div key={key} className="rounded-xl border border-border-primary bg-bg-card px-4 py-3">
                  <div className="text-xs uppercase tracking-wide text-text-muted mb-1">{key}</div>
                  <div className="text-sm text-text-primary break-all whitespace-pre-wrap">
                    {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      {showAdvanced && (
        <CollapsibleSection
          title="直接关系"
          description="高级结构层，默认折叠，包含原始关系边维护。"
        >
          {entity.relations.length === 0 ? (
            <div className="text-sm text-text-muted">暂无直接关系。</div>
          ) : (
            <div className="space-y-2">
              {entity.relations.map((relation, index) => (
                <div
                  key={`${relation.predicateId}-${relation.targetId}-${index}`}
                  className="rounded-xl border border-border-primary bg-bg-card px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onSelectEntity(relation.targetId)}
                      className="text-left flex-1 hover:text-primary transition-colors"
                    >
                      <div className="text-xs text-text-muted mb-1">{relation.predicateId}</div>
                      <div className="text-sm text-text-primary">
                        {resolveKnowledgeNodeLabel(dataset, relation.targetId)}
                      </div>
                    </button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 className="w-4 h-4" />}
                      onClick={() =>
                        onDeleteRelation(
                          entity.id,
                          relation.predicateId,
                          relation.targetId,
                          resolveKnowledgeNodeLabel(dataset, relation.targetId)
                        )
                      }
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      <div>
        <div className="section-title mb-3">
          <Network className="section-title-icon" />
          {showAdvanced ? '关联实体' : '相关条目'}
        </div>
        {relatedEntities.length === 0 ? (
          <div className="text-sm text-text-muted">
            {showAdvanced ? '暂无扩展关联实体。' : '暂无相关知识条目。'}
          </div>
        ) : (
          <div className="space-y-2">
            {relatedEntities.map((related) => (
              <button
                key={related.id}
                type="button"
                onClick={() => onSelectEntity(related.id)}
                className="w-full rounded-xl border border-border-primary bg-bg-secondary px-4 py-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-text-primary">{related.title}</div>
                    <div className="text-xs text-text-muted mt-1">{related.typeId}</div>
                  </div>
                  <span className="badge badge-primary">
                    {related.tags[0] || (showAdvanced ? '实体' : '条目')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showAdvanced && (
        <CollapsibleSection
          title="关联事实（断言）"
          description="高级事实层，包含证据和标量值等原始断言信息。"
        >
          {assertions.length === 0 ? (
            <div className="text-sm text-text-muted">暂无关联事实记录。</div>
          ) : (
            <div className="space-y-2">
              {assertions.map((assertion) => (
                <AssertionCard
                  key={assertion.id}
                  assertion={assertion}
                  dataset={dataset}
                  editable={showAdvanced}
                  onEdit={onEditAssertion}
                  onDelete={onDeleteAssertion}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
          <div className="text-xs text-text-muted mb-1">来源</div>
          <div className="text-sm text-text-primary">{entity.source || '未记录'}</div>
        </div>
        <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
          <div className="text-xs text-text-muted mb-1">更新时间</div>
          <div className="text-sm text-text-primary">{formatTimestamp(entity.updatedAt)}</div>
        </div>
      </div>
    </div>
  );
}

function DocumentDetail({
  document,
  dataset,
  mode,
  onSelectEntity,
  onEditAssertion,
  onDeleteAssertion,
}: {
  document: KnowledgeDocument;
  dataset: KnowledgeDataset;
  mode: KnowledgeViewMode;
  onSelectEntity: (id: string) => void;
  onEditAssertion: (assertion: KnowledgeAssertion) => void;
  onDeleteAssertion: (assertion: KnowledgeAssertion) => void;
}) {
  const linkedEntities = document.entityIds
    .map((id) => getKnowledgeEntityById(id))
    .filter((entity): entity is KnowledgeEntity => Boolean(entity));
  const assertions = getDocumentAssertions(dataset, document.id);
  const showAdvanced = mode === 'advanced';

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="badge badge-warning">{mode === 'advanced' ? '文档' : '来源文档'}</span>
          <span className="badge badge-primary">{document.id}</span>
        </div>
        <h2 className="text-2xl font-semibold text-text-primary">{document.title}</h2>
        <p className="text-sm text-text-secondary mt-2">{document.summary || '暂无摘要。'}</p>
      </div>

      <div>
        <div className="section-title mb-3">
          <BookOpen className="section-title-icon" />
          内容摘要
        </div>
        <div className="rounded-2xl border border-border-primary bg-bg-secondary p-4">
          <div className="text-sm text-text-primary whitespace-pre-wrap break-words leading-6">
            {document.content || '暂无内容。'}
          </div>
        </div>
      </div>

      {document.tags.length > 0 && (
        <div>
          <div className="section-title mb-3">
            <Tags className="section-title-icon" />
            标签
          </div>
          <div className="flex flex-wrap gap-2">
            {document.tags.map((tag) => (
              <span key={tag} className="badge badge-success">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="section-title mb-3">
          <Network className="section-title-icon" />
          {showAdvanced ? '关联实体' : '关联知识条目'}
        </div>
        {linkedEntities.length === 0 ? (
          <div className="text-sm text-text-muted">
            {showAdvanced ? '暂无关联实体。' : '暂无关联知识条目。'}
          </div>
        ) : (
          <div className="space-y-2">
            {linkedEntities.map((entity) => (
              <button
                key={entity.id}
                type="button"
                onClick={() => onSelectEntity(entity.id)}
                className="w-full rounded-xl border border-border-primary bg-bg-secondary px-4 py-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <div className="text-sm font-medium text-text-primary">{entity.title}</div>
                <div className="text-xs text-text-muted mt-1">{entity.typeId}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showAdvanced && (
        <CollapsibleSection
          title="证据事实（断言）"
          description="高级模式下查看引用该文档的断言与证据链。"
        >
          {assertions.length === 0 ? (
            <div className="text-sm text-text-muted">暂无引用该文档的事实记录。</div>
          ) : (
            <div className="space-y-2">
              {assertions.map((assertion) => (
                <AssertionCard
                  key={assertion.id}
                  assertion={assertion}
                  dataset={dataset}
                  editable={showAdvanced}
                  onEdit={onEditAssertion}
                  onDelete={onDeleteAssertion}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
          <div className="text-xs text-text-muted mb-1">来源</div>
          <div className="text-sm text-text-primary">{document.source || '未记录'}</div>
        </div>
        <div className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-3">
          <div className="text-xs text-text-muted mb-1">更新时间</div>
          <div className="text-sm text-text-primary">{formatTimestamp(document.updatedAt)}</div>
        </div>
      </div>
    </div>
  );
}

export default function Knowledge() {
  const [overview, setOverview] = useState<KnowledgeOverview>(getKnowledgeOverview());
  const [viewMode, setViewMode] = useState<KnowledgeViewMode>('browse');
  const [isCreateGuideOpen, setCreateGuideOpen] = useState(false);
  const [isDebugDrawerOpen, setDebugDrawerOpen] = useState(false);
  const [guidedIntent, setGuidedIntent] = useState<KnowledgeCreateIntent | null>(null);
  const [isGuidedEntityModalOpen, setGuidedEntityModalOpen] = useState(false);
  const [isGuidedDocumentModalOpen, setGuidedDocumentModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState('all');
  const [includeDocuments, setIncludeDocuments] = useState(true);
  const [selectedHit, setSelectedHit] = useState<SelectedHit | null>(null);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rebuildingProjections, setRebuildingProjections] = useState(false);
  const [isOntologyManagerOpen, setOntologyManagerOpen] = useState(false);
  const [ontologyTab, setOntologyTab] = useState<'classes' | 'relations'>('classes');
  const [editingOntologyClass, setEditingOntologyClass] = useState<OntologyClass | null>(null);
  const [editingOntologyRelation, setEditingOntologyRelation] = useState<OntologyRelation | null>(null);
  const [ontologyClassForm, setOntologyClassForm] = useState<OntologyClassFormState>(
    createOntologyClassFormState(null)
  );
  const [ontologyRelationForm, setOntologyRelationForm] = useState<OntologyRelationFormState>(
    createOntologyRelationFormState(null)
  );
  const [ontologyError, setOntologyError] = useState('');
  const [savingOntology, setSavingOntology] = useState(false);

  const [isEntityModalOpen, setEntityModalOpen] = useState(false);
  const [entityModalIntent, setEntityModalIntent] = useState<KnowledgeCreateIntent | null>(null);
  const [editingEntity, setEditingEntity] = useState<KnowledgeEntity | null>(null);
  const [entityForm, setEntityForm] = useState<EntityFormState>(
    createEntityFormState(null, 'class:thing')
  );
  const [entityError, setEntityError] = useState('');
  const [savingEntity, setSavingEntity] = useState(false);
  const [guidedEntityForm, setGuidedEntityForm] = useState<GuidedEntityFormState>(
    createGuidedEntityFormState()
  );

  const [isRelationModalOpen, setRelationModalOpen] = useState(false);
  const [relationForm, setRelationForm] = useState<RelationFormState>(
    createRelationFormState('', '', '')
  );
  const [relationError, setRelationError] = useState('');
  const [savingRelation, setSavingRelation] = useState(false);

  const [isDocumentModalOpen, setDocumentModalOpen] = useState(false);
  const [documentModalIntent, setDocumentModalIntent] = useState<KnowledgeCreateIntent | null>(null);
  const [editingDocument, setEditingDocument] = useState<KnowledgeDocument | null>(null);
  const [documentForm, setDocumentForm] = useState<DocumentFormState>(
    createDocumentFormState(null)
  );
  const [documentError, setDocumentError] = useState('');
  const [savingDocument, setSavingDocument] = useState(false);
  const [guidedDocumentForm, setGuidedDocumentForm] = useState<GuidedDocumentFormState>(
    createGuidedDocumentFormState()
  );
  const [serverKnowledgeSnapshot, setServerKnowledgeSnapshot] = useState<ServerKnowledgeSnapshotSummary | null>(null);
  const [serverSnapshotError, setServerSnapshotError] = useState('');
  const [loadingServerSnapshot, setLoadingServerSnapshot] = useState(false);

  const [isAssertionModalOpen, setAssertionModalOpen] = useState(false);
  const [editingAssertion, setEditingAssertion] = useState<KnowledgeAssertion | null>(null);
  const [assertionForm, setAssertionForm] = useState<AssertionFormState>(
    createAssertionFormState(null)
  );
  const [assertionError, setAssertionError] = useState('');
  const [savingAssertion, setSavingAssertion] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setOverview(getKnowledgeOverview());
      setRefreshToken((prev) => prev + 1);
    };

    refresh();
    return subscribeKnowledge(refresh);
  }, []);

  const dataset = useMemo(() => getKnowledgeDataset(), [refreshToken]);
  const mappedEntityCount = useMemo(
    () => dataset.entities.filter((entity) => isTaskMappedEntity(entity) || isFinanceMappedEntity(entity)).length,
    [dataset]
  );
  const manualEntityCount = dataset.entities.length - mappedEntityCount;
  const recentItems = useMemo<KnowledgeSpotlightItem[]>(
    () =>
      [
        ...dataset.entities.map((entity) => ({
          id: entity.id,
          title: entity.title,
          summary: entity.summary || getEntityOriginMeta(entity).description,
          kind: 'entity' as const,
          badge: getEntityOriginMeta(entity).label,
          updatedAt: entity.updatedAt,
        })),
        ...dataset.documents.map((document) => ({
          id: document.id,
          title: document.title,
          summary: document.summary || document.source || '暂无摘要。',
          kind: 'document' as const,
          badge: '来源文档',
          updatedAt: document.updatedAt,
        })),
      ]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 6),
    [dataset]
  );
  const spotlightItems = useMemo<KnowledgeSpotlightItem[]>(
    () =>
      [
        ...dataset.entities
          .filter((entity) => !isTaskMappedEntity(entity) && !isFinanceMappedEntity(entity))
          .slice(0, 3)
          .map((entity) => ({
            id: entity.id,
            title: entity.title,
            summary: entity.summary || '暂无摘要。',
            kind: 'entity' as const,
            badge: '人工知识',
            updatedAt: entity.updatedAt,
          })),
        ...dataset.documents.slice(0, 2).map((document) => ({
          id: document.id,
          title: document.title,
          summary: document.summary || '暂无摘要。',
          kind: 'document' as const,
          badge: '来源文档',
          updatedAt: document.updatedAt,
        })),
      ].slice(0, 5),
    [dataset]
  );

  const classOptions = useMemo(
    () => dataset.ontology.classes.map((item) => ({ id: item.id, label: item.label })),
    [dataset]
  );

  const relationOptions = useMemo(
    () => dataset.ontology.relations.map((item) => ({ id: item.id, label: item.label })),
    [dataset]
  );

  const objectOptions = useMemo(
    () => [
      ...dataset.entities.map((entity) => ({
        id: entity.id,
        label: entity.title,
        kind: 'entity' as const,
      })),
      ...dataset.documents.map((document) => ({
        id: document.id,
        label: document.title,
        kind: 'document' as const,
      })),
    ],
    [dataset]
  );

  useEffect(() => {
    let disposed = false;

    const runSearch = async () => {
      setSearchLoading(true);
      try {
        const items = await searchKnowledgeRemote(searchQuery, {
          typeIds: selectedTypeId === 'all' ? undefined : [selectedTypeId],
          includeDocuments,
          limit: 24,
        });
        if (!disposed) {
          setSearchResults(items);
        }
      } catch (error) {
        if (!disposed) {
          setSearchResults([]);
          setFeedback({
            type: 'error',
            message: error instanceof Error ? error.message : '知识搜索失败。',
          });
        }
      } finally {
        if (!disposed) {
          setSearchLoading(false);
        }
      }
    };

    void runSearch();
    return () => {
      disposed = true;
    };
  }, [searchQuery, selectedTypeId, includeDocuments, refreshToken]);

  useEffect(() => {
    if (searchResults.length === 0) {
      setSelectedHit(null);
      return;
    }

    if (
      !selectedHit ||
      !searchResults.some((item) => item.kind === selectedHit.kind && item.id === selectedHit.id)
    ) {
      setSelectedHit({ kind: searchResults[0].kind, id: searchResults[0].id });
    }
  }, [searchResults, selectedHit]);

  const selectedEntity =
    selectedHit?.kind === 'entity' ? getKnowledgeEntityById(selectedHit.id) : undefined;
  const selectedDocument =
    selectedHit?.kind === 'document' ? getKnowledgeDocumentById(selectedHit.id) : undefined;

  const defaultClassId = classOptions[0]?.id || 'class:thing';
  const defaultRelationId = relationOptions[0]?.id || 'relation:relatedTo';
  const defaultSubjectId = selectedEntity?.id || dataset.entities[0]?.id || '';
  const defaultRelationTargetId =
    dataset.entities.find((entity) => entity.id !== defaultSubjectId)?.id || '';

  const handleSelectEntity = (id: string) => {
    setSelectedHit({ kind: 'entity', id });
  };

  const handleSelectSpotlight = (item: KnowledgeSpotlightItem) => {
    setSelectedHit({ kind: item.kind, id: item.id });
  };

  const handleCreateIntent = (intent: KnowledgeCreateIntent) => {
    setCreateGuideOpen(false);
    setGuidedIntent(intent);

    if (intent === 'project-note') {
      setGuidedEntityForm(createGuidedEntityFormState());
      setEntityError('');
      setGuidedEntityModalOpen(true);
      return;
    }

    if (intent === 'source-document') {
      setGuidedDocumentForm(createGuidedDocumentFormState(selectedEntity ? [selectedEntity.id] : []));
      setDocumentError('');
      setGuidedDocumentModalOpen(true);
      return;
    }

    if (intent === 'business-note') {
      if (selectedEntity) {
        setGuidedDocumentForm(createGuidedDocumentFormState([selectedEntity.id]));
        setDocumentError('');
        setGuidedDocumentModalOpen(true);
        return;
      }

      setGuidedEntityForm(createGuidedEntityFormState());
      setEntityError('');
      setGuidedEntityModalOpen(true);
      return;
    }

    if (intent === 'structure-link') {
      openRelationModal();
    }
  };

  useEffect(() => {
    if (!isDebugDrawerOpen) {
      return;
    }

    let disposed = false;
    const loadServerKnowledgeSnapshot = async () => {
      try {
        setLoadingServerSnapshot(true);
        setServerSnapshotError('');
        const response = await fetchWithAuth(`/api/knowledge/dataset?ts=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          data?: KnowledgeDataset;
        };

        const knowledge = payload.data;
        if (!knowledge || typeof knowledge !== 'object') {
          throw new Error('服务端未返回 knowledge 字段');
        }

        if (disposed) {
          return;
        }

        setServerKnowledgeSnapshot({
          updatedAt: typeof knowledge.updatedAt === 'number' ? knowledge.updatedAt : 0,
          entityCount: Array.isArray(knowledge.entities) ? knowledge.entities.length : 0,
          documentCount: Array.isArray(knowledge.documents) ? knowledge.documents.length : 0,
          assertionCount: Array.isArray(knowledge.assertions) ? knowledge.assertions.length : 0,
          classCount: Array.isArray(knowledge.ontology?.classes) ? knowledge.ontology.classes.length : 0,
          relationCount: Array.isArray(knowledge.ontology?.relations) ? knowledge.ontology.relations.length : 0,
        });
      } catch (error) {
        if (!disposed) {
          setServerSnapshotError(error instanceof Error ? error.message : '服务端快照读取失败');
          setServerKnowledgeSnapshot(null);
        }
      } finally {
        if (!disposed) {
          setLoadingServerSnapshot(false);
        }
      }
    };

    void loadServerKnowledgeSnapshot();
    return () => {
      disposed = true;
    };
  }, [isDebugDrawerOpen]);

  const openCreateEntityModal = (intent: KnowledgeCreateIntent | null = null) => {
    setEditingEntity(null);
    setEntityModalIntent(intent);
    setEntityError('');
    setFeedback(null);
    setEntityForm(
      createEntityFormState(
        null,
        selectedTypeId !== 'all' ? selectedTypeId : selectedEntity?.typeId || defaultClassId
      )
    );
    setEntityModalOpen(true);
  };

  const openEditEntityModal = () => {
    if (!selectedEntity) {
      return;
    }

    setEditingEntity(selectedEntity);
    setEntityModalIntent(null);
    setEntityError('');
    setFeedback(null);
    setEntityForm(createEntityFormState(selectedEntity, selectedEntity.typeId));
    setEntityModalOpen(true);
  };

  const openCreateDocumentModal = (intent: KnowledgeCreateIntent | null = null) => {
    setEditingDocument(null);
    setDocumentModalIntent(intent);
    setDocumentError('');
    setFeedback(null);
    setDocumentForm(
      createDocumentFormState(null, selectedEntity ? [selectedEntity.id] : [])
    );
    setDocumentModalOpen(true);
  };

  const openEditDocumentModal = () => {
    if (!selectedDocument) {
      return;
    }

    setEditingDocument(selectedDocument);
    setDocumentModalIntent(null);
    setDocumentError('');
    setFeedback(null);
    setDocumentForm(createDocumentFormState(selectedDocument));
    setDocumentModalOpen(true);
  };

  const runDeleteAction = async (action: () => Promise<void>, successMessage: string) => {
    setFeedback(null);

    try {
      setDeleting(true);
      await action();
      setDeleteDialog(null);
      setFeedback({ type: 'success', message: successMessage });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : '删除失败。',
      });
    } finally {
      setDeleting(false);
    }
  };

  const openRelationModal = () => {
    if (!selectedEntity) {
      return;
    }

    setRelationError('');
    setFeedback(null);
    setRelationForm(
      createRelationFormState(selectedEntity.id, defaultRelationId, defaultRelationTargetId)
    );
    setRelationModalOpen(true);
  };

  const openDeleteEntityDialog = () => {
    if (!selectedEntity) {
      return;
    }

    const entityId = selectedEntity.id;
    const title = selectedEntity.title;
    setDeleteDialog({
      title: '删除知识条目',
      description: `将删除知识条目“${title}”，并级联清理相关结构关联、文档关联和事实记录。此操作无法撤销。`,
      confirmLabel: '删除知识条目',
      onConfirm: async () => {
        await runDeleteAction(async () => {
          await deleteKnowledgeEntity(entityId);
          setSelectedHit(null);
        }, '知识条目已删除，关联引用已同步清理。');
      },
    });
  };

  const openDeleteDocumentDialog = () => {
    if (!selectedDocument) {
      return;
    }

    const documentId = selectedDocument.id;
    const title = selectedDocument.title;
    setDeleteDialog({
      title: '删除来源文档',
      description: `将删除来源文档“${title}”，并清理引用该文档的证据记录与事实引用。此操作无法撤销。`,
      confirmLabel: '删除来源文档',
      onConfirm: async () => {
        await runDeleteAction(async () => {
          await deleteKnowledgeDocument(documentId);
          setSelectedHit(null);
        }, '来源文档已删除，相关证据引用已同步更新。');
      },
    });
  };

  const openDeleteAssertionDialog = (assertion: KnowledgeAssertion) => {
    const assertionId = assertion.id;
    setDeleteDialog({
      title: '删除事实记录（断言）',
      description: '将删除这条事实记录；如果它对应一条结构化关系边，也会一并撤销。此操作无法撤销。',
      confirmLabel: '删除事实记录',
      onConfirm: async () => {
        await runDeleteAction(async () => {
          await deleteKnowledgeAssertion(assertionId);
        }, '事实记录已删除。');
      },
    });
  };

  const openDeleteRelationDialog = (
    subjectId: string,
    predicateId: string,
    targetId: string,
    targetLabel: string
  ) => {
    setDeleteDialog({
      title: '删除结构关联（关系）',
      description: `将删除当前结构关联“${predicateId} -> ${targetLabel}”，并同步移除对应事实记录。此操作无法撤销。`,
      confirmLabel: '删除结构关联',
      onConfirm: async () => {
        await runDeleteAction(async () => {
          await deleteKnowledgeRelation(subjectId, predicateId, targetId);
        }, '结构关联已删除，对应事实记录已同步移除。');
      },
    });
  };

  const openCreateAssertionModal = (defaults: Partial<AssertionFormState> = {}) => {
    setEditingAssertion(null);
    setAssertionError('');
    setFeedback(null);
    setAssertionForm(
      createAssertionFormState(null, {
        subjectId: defaults.subjectId || defaultSubjectId,
        predicateId: defaults.predicateId || defaultRelationId,
        objectId: defaults.objectId || '',
        evidenceDocumentIds: defaults.evidenceDocumentIds || [],
        value: defaults.value || '',
        source: defaults.source || '',
        confidence: defaults.confidence || '',
      })
    );
    setAssertionModalOpen(true);
  };

  const openEditAssertionModal = (assertion: KnowledgeAssertion) => {
    setEditingAssertion(assertion);
    setAssertionError('');
    setFeedback(null);
    setAssertionForm(createAssertionFormState(assertion));
    setAssertionModalOpen(true);
  };

  const handleEntitySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEntityError('');
    setFeedback(null);

    try {
      if (!entityForm.title.trim()) {
        throw new Error('知识条目标题不能为空。');
      }

      setSavingEntity(true);

      const savedEntity = await upsertKnowledgeEntity({
        id: editingEntity?.id,
        typeId: entityForm.typeId,
        title: entityForm.title,
        summary: entityForm.summary,
        aliases: parseListInput(entityForm.aliases),
        tags: parseListInput(entityForm.tags),
        attributes: parseAttributes(entityForm.attributesText),
        source: entityForm.source,
        confidence: parseConfidence(entityForm.confidence),
      });

      setSelectedHit({ kind: 'entity', id: savedEntity.id });
      setEntityModalOpen(false);
      setEditingEntity(null);
      setEntityModalIntent(null);
      setFeedback({
        type: 'success',
        message: editingEntity ? '知识条目已更新并写入知识库。' : '知识条目已创建并写入知识库。',
      });
    } catch (error) {
      setEntityError(error instanceof Error ? error.message : '保存知识条目失败。');
    } finally {
      setSavingEntity(false);
    }
  };

  const handleDocumentSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDocumentError('');
    setFeedback(null);

    try {
      if (!documentForm.title.trim()) {
        throw new Error('文档标题不能为空。');
      }

      setSavingDocument(true);

      const savedDocument = await upsertKnowledgeDocument({
        id: editingDocument?.id,
        title: documentForm.title,
        summary: documentForm.summary,
        content: documentForm.content,
        tags: parseListInput(documentForm.tags),
        entityIds: documentForm.entityIds,
        source: documentForm.source,
      });

      setSelectedHit({ kind: 'document', id: savedDocument.id });
      setDocumentModalOpen(false);
      setEditingDocument(null);
      setDocumentModalIntent(null);
      setFeedback({
        type: 'success',
        message: editingDocument ? '来源文档已更新并写入知识库。' : '来源文档已创建并写入知识库。',
      });
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : '保存来源文档失败。');
    } finally {
      setSavingDocument(false);
    }
  };

  const handleRelationSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRelationError('');
    setFeedback(null);

    try {
      if (!relationForm.subjectId || !relationForm.predicateId || !relationForm.targetId) {
        throw new Error('请完整选择起点条目、关联类型和目标条目。');
      }

      if (relationForm.subjectId === relationForm.targetId) {
        throw new Error('起点条目和目标条目不能相同。');
      }

      setSavingRelation(true);

      await createKnowledgeRelation({
        subjectId: relationForm.subjectId,
        predicateId: relationForm.predicateId,
        targetId: relationForm.targetId,
        source: relationForm.source,
        confidence: parseConfidence(relationForm.confidence),
      });

      setSelectedHit({ kind: 'entity', id: relationForm.subjectId });
      setRelationModalOpen(false);
      setFeedback({
        type: 'success',
        message: '结构关联已写入知识库，并同步生成事实记录。',
      });
    } catch (error) {
      setRelationError(error instanceof Error ? error.message : '创建结构关联失败。');
    } finally {
      setSavingRelation(false);
    }
  };

  const handleAssertionSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAssertionError('');
    setFeedback(null);

    try {
      if (!assertionForm.subjectId || !assertionForm.predicateId) {
        throw new Error('事实记录的主体和谓词不能为空。');
      }

      const parsedValue = parseAssertionValue(assertionForm.value);
      if (!assertionForm.objectId && parsedValue === undefined) {
        throw new Error('请至少提供目标对象或标量值。');
      }

      setSavingAssertion(true);

      await upsertKnowledgeAssertion({
        id: editingAssertion?.id,
        subjectId: assertionForm.subjectId,
        predicateId: assertionForm.predicateId,
        objectId: assertionForm.objectId || undefined,
        value: parsedValue,
        evidenceDocumentIds: assertionForm.evidenceDocumentIds,
        source: assertionForm.source,
        confidence: parseConfidence(assertionForm.confidence),
      });

      if (selectedDocument) {
        setSelectedHit({ kind: 'document', id: selectedDocument.id });
      } else {
        setSelectedHit({ kind: 'entity', id: assertionForm.subjectId });
      }

      setAssertionModalOpen(false);
      setEditingAssertion(null);
      setFeedback({
        type: 'success',
        message: editingAssertion ? '事实记录已更新并写入知识库。' : '事实记录已创建并写入知识库。',
      });
    } catch (error) {
      setAssertionError(error instanceof Error ? error.message : '保存事实记录失败。');
    } finally {
      setSavingAssertion(false);
    }
  };

  const handleGuidedEntitySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEntityError('');
    setFeedback(null);

    try {
      if (!guidedEntityForm.title.trim()) {
        throw new Error('标题不能为空。');
      }

      setSavingEntity(true);
      const typeId = guidedIntent === 'business-note' ? 'class:thing' : 'class:thing';
      const savedEntity = await upsertKnowledgeEntity({
        typeId,
        title: guidedEntityForm.title,
        summary: guidedEntityForm.summary,
        tags: parseListInput(guidedEntityForm.tags),
        source: guidedEntityForm.source,
      });

      setSelectedHit({ kind: 'entity', id: savedEntity.id });
      setGuidedEntityModalOpen(false);
      setGuidedIntent(null);
      setGuidedEntityForm(createGuidedEntityFormState());
      setFeedback({
        type: 'success',
        message: guidedIntent === 'business-note' ? '业务备注已创建并写入知识库。' : '项目知识已创建并写入知识库。',
      });
    } catch (error) {
      setEntityError(error instanceof Error ? error.message : '创建知识失败。');
    } finally {
      setSavingEntity(false);
    }
  };

  const handleGuidedDocumentSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDocumentError('');
    setFeedback(null);

    try {
      if (!guidedDocumentForm.title.trim()) {
        throw new Error('标题不能为空。');
      }

      setSavingDocument(true);
      const savedDocument = await upsertKnowledgeDocument({
        title: guidedDocumentForm.title,
        summary: guidedDocumentForm.summary,
        content: guidedDocumentForm.content,
        tags: parseListInput(guidedDocumentForm.tags),
        entityIds: guidedDocumentForm.entityIds,
        source: guidedDocumentForm.source,
      });

      setSelectedHit({ kind: 'document', id: savedDocument.id });
      setGuidedDocumentModalOpen(false);
      setGuidedIntent(null);
      setGuidedDocumentForm(createGuidedDocumentFormState());
      setFeedback({
        type: 'success',
        message: guidedIntent === 'business-note' ? '业务备注已创建并挂接到知识库。' : '说明文档已创建并写入知识库。',
      });
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : '创建文档失败。');
    } finally {
      setSavingDocument(false);
    }
  };

  const openOntologyManager = (tab: 'classes' | 'relations' = 'classes') => {
    setOntologyTab(tab);
    setOntologyError('');
    setFeedback(null);
    setEditingOntologyClass(null);
    setEditingOntologyRelation(null);
    setOntologyClassForm(createOntologyClassFormState(null));
    setOntologyRelationForm(createOntologyRelationFormState(null));
    setOntologyManagerOpen(true);
  };

  const openOntologyClassEditor = (item?: OntologyClass) => {
    setOntologyTab('classes');
    setOntologyError('');
    setEditingOntologyRelation(null);
    setOntologyRelationForm(createOntologyRelationFormState(null));
    setEditingOntologyClass(item || null);
    setOntologyClassForm(createOntologyClassFormState(item || null));
    setOntologyManagerOpen(true);
  };

  const openOntologyRelationEditor = (item?: OntologyRelation) => {
    setOntologyTab('relations');
    setOntologyError('');
    setEditingOntologyClass(null);
    setOntologyClassForm(createOntologyClassFormState(null));
    setEditingOntologyRelation(item || null);
    setOntologyRelationForm(createOntologyRelationFormState(item || null));
    setOntologyManagerOpen(true);
  };

  const handleRebuildProjections = async () => {
    setFeedback(null);

    try {
      setRebuildingProjections(true);
      const result = await rebuildKnowledgeProjections();
      setFeedback({
        type: 'success',
        message: `知识投影重建任务已入队：任务 ${result.queuedTaskProjections} 条，财务 ${result.queuedFinanceProjections} 条。`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : '重建知识投影失败。',
      });
    } finally {
      setRebuildingProjections(false);
    }
  };

  const handleOntologyClassSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOntologyError('');
    setFeedback(null);

    try {
      const classId = ontologyClassForm.id.trim();
      const classLabel = ontologyClassForm.label.trim();
      const parentIds = parseListInput(ontologyClassForm.parentIds);

      if (!classId) {
        throw new Error('类 ID 不能为空。');
      }

      if (!isOntologyIdLike(classId)) {
        throw new Error('类 ID 格式应类似 class:project，使用前缀加短横线标识。');
      }

      if (!classLabel) {
        throw new Error('类名称不能为空。');
      }

      if (
        !editingOntologyClass &&
        dataset.ontology.classes.some((item) => item.id.toLowerCase() === classId.toLowerCase())
      ) {
        throw new Error('类 ID 已存在，请使用新的 ID。');
      }

      if (parentIds.includes(classId)) {
        throw new Error('父类列表不能包含当前类自身。');
      }

      setSavingOntology(true);
      const saved = await upsertOntologyClass(
        {
          id: classId,
          label: classLabel,
          description: ontologyClassForm.description.trim() || undefined,
          parentIds,
        },
        editingOntologyClass ? { existingId: editingOntologyClass.id } : undefined
      );

      setEditingOntologyClass(saved);
      setOntologyClassForm(createOntologyClassFormState(saved));
      setFeedback({
        type: 'success',
        message: editingOntologyClass ? 'Ontology 类定义已更新。' : 'Ontology 类定义已创建。',
      });
    } catch (error) {
      setOntologyError(error instanceof Error ? error.message : '保存类定义失败。');
    } finally {
      setSavingOntology(false);
    }
  };

  const handleOntologyRelationSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOntologyError('');
    setFeedback(null);

    try {
      const relationId = ontologyRelationForm.id.trim();
      const relationLabel = ontologyRelationForm.label.trim();
      const inverseId = ontologyRelationForm.inverseId.trim();

      if (!relationId) {
        throw new Error('关系 ID 不能为空。');
      }

      if (!isOntologyIdLike(relationId)) {
        throw new Error('关系 ID 格式应类似 rel:depends-on，使用前缀加短横线标识。');
      }

      if (!relationLabel) {
        throw new Error('关系名称不能为空。');
      }

      if (
        !editingOntologyRelation &&
        dataset.ontology.relations.some((item) => item.id.toLowerCase() === relationId.toLowerCase())
      ) {
        throw new Error('关系 ID 已存在，请使用新的 ID。');
      }

      if (inverseId && inverseId === relationId) {
        throw new Error('Inverse 关系不能指向自身。');
      }

      setSavingOntology(true);
      const saved = await upsertOntologyRelation(
        {
          id: relationId,
          label: relationLabel,
          description: ontologyRelationForm.description.trim() || undefined,
          inverseId: inverseId || undefined,
          symmetric: ontologyRelationForm.symmetric,
          transitive: ontologyRelationForm.transitive,
        },
        editingOntologyRelation ? { existingId: editingOntologyRelation.id } : undefined
      );

      setEditingOntologyRelation(saved);
      setOntologyRelationForm(createOntologyRelationFormState(saved));
      setFeedback({
        type: 'success',
        message: editingOntologyRelation ? 'Ontology 关系定义已更新。' : 'Ontology 关系定义已创建。',
      });
    } catch (error) {
      setOntologyError(error instanceof Error ? error.message : '保存关系定义失败。');
    } finally {
      setSavingOntology(false);
    }
  };

  const openDeleteOntologyClassDialog = (item: OntologyClass) => {
    setDeleteDialog({
      title: '删除 Ontology 类定义',
      description: `将删除类定义“${item.label}”。如果仍被实体类型、子类或其他结构引用，后端会拒绝删除。此操作无法撤销。`,
      confirmLabel: '删除类定义',
      onConfirm: async () => {
        await runDeleteAction(async () => {
          await deleteOntologyClass(item.id);
          if (editingOntologyClass?.id === item.id) {
            setEditingOntologyClass(null);
            setOntologyClassForm(createOntologyClassFormState(null));
          }
        }, 'Ontology 类定义已删除。');
      },
    });
  };

  const openDeleteOntologyRelationDialog = (item: OntologyRelation) => {
    setDeleteDialog({
      title: '删除 Ontology 关系定义',
      description: `将删除关系定义“${item.label}”。如果仍被事实记录、结构边或 inverse 关系引用，后端会拒绝删除。此操作无法撤销。`,
      confirmLabel: '删除关系定义',
      onConfirm: async () => {
        await runDeleteAction(async () => {
          await deleteOntologyRelation(item.id);
          if (editingOntologyRelation?.id === item.id) {
            setEditingOntologyRelation(null);
            setOntologyRelationForm(createOntologyRelationFormState(null));
          }
        }, 'Ontology 关系定义已删除。');
      },
    });
  };

  const handleFilterByOntologyClass = (item: OntologyClass) => {
    setSelectedTypeId(item.id);
    setIncludeDocuments(false);
    setSearchQuery('');
    setOntologyManagerOpen(false);
    setFeedback({
      type: 'success',
      message: `已按类定义“${item.label}”筛选知识条目。`,
    });
  };

  const handleFilterByOntologyRelation = (item: OntologyRelation) => {
    setSearchQuery(item.label);
    setIncludeDocuments(false);
    setOntologyManagerOpen(false);
    setFeedback({
      type: 'success',
      message: `已按关系定义“${item.label}”填充搜索词，可继续查看相关事实记录与结构边。`,
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="page-header">
        <div className="page-header-icon bg-[linear-gradient(135deg,#0f172a,#2563eb)]">
          <Network className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="page-header-title">知识库</h1>
          <p className="page-header-subtitle">以检索、阅读和来源追踪为主的项目知识中心，维护与高级结构能力已后移。</p>
        </div>
      </motion.div>

      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl border px-4 py-3 mb-6 text-sm flex items-start gap-2 ${
            feedback.type === 'success'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-error/30 bg-error/10 text-error'
          }`}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{feedback.message}</span>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-6"
      >
        <KnowledgeOverviewCard icon={Shapes} label="知识类型" value={overview.classCount} tone="primary" />
        <KnowledgeOverviewCard icon={Link2} label="结构关联" value={overview.relationCount} tone="success" />
        <KnowledgeOverviewCard icon={Database} label="知识条目" value={overview.entityCount} tone="warning" />
        <KnowledgeOverviewCard icon={FileText} label="来源文档" value={overview.documentCount} tone="info" />
        <KnowledgeOverviewCard icon={Sparkles} label="事实记录" value={overview.assertionCount} tone="primary" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="rounded-2xl border border-border-primary bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_45%),linear-gradient(180deg,var(--bg-card),var(--bg-card))] p-5 mb-6"
      >
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5">
          <div className="space-y-4">
            <div>
              <div className="text-lg font-semibold text-text-primary">模式分层</div>
              <div className="text-sm text-text-secondary mt-1">
                默认阅读模式只保留查找、阅读和来源追踪；结构维护与高级诊断需要显式切换。
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ViewModeButton
                active={viewMode === 'browse'}
                title="阅读模式"
                description="面向日常查找与阅读，默认隐藏复杂结构操作。"
                onClick={() => setViewMode('browse')}
              />
              <ViewModeButton
                active={viewMode === 'manage'}
                title="维护模式"
                description="保留高频维护动作，如编辑知识条目、来源文档和补充关联。"
                onClick={() => setViewMode('manage')}
              />
              <ViewModeButton
                active={viewMode === 'advanced'}
                title="高级模式"
                description="暴露断言、关系边、删除与结构调试等底层能力。"
                onClick={() => setViewMode('advanced')}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {viewMode !== 'browse' && (
                <>
                  <Button variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreateGuideOpen(true)}>
                    补充知识
                  </Button>
                </>
              )}
              {viewMode === 'advanced' && (
                <>
                  <Button
                    variant="ghost"
                    icon={<Shapes className="w-4 h-4" />}
                    onClick={() => openOntologyManager('classes')}
                  >
                    Ontology
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Database className="w-4 h-4" />}
                    onClick={() => void handleRebuildProjections()}
                    loading={rebuildingProjections}
                  >
                    重建投影
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<Sparkles className="w-4 h-4" />}
                    onClick={() =>
                      openCreateAssertionModal(
                        selectedEntity
                          ? { subjectId: selectedEntity.id }
                          : selectedDocument
                            ? { evidenceDocumentIds: [selectedDocument.id], subjectId: defaultSubjectId }
                            : {}
                      )
                    }
                    disabled={!defaultSubjectId}
                  >
                    新增事实记录
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<Bug className="w-4 h-4" />}
                    onClick={() => setDebugDrawerOpen(true)}
                  >
                    调试信息
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-border-primary bg-bg-secondary p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-text-primary">当前知识规模</div>
              <div className="text-xs text-text-muted flex items-center gap-2">
                <Clock3 className="w-3.5 h-3.5" />
                {formatTimestamp(overview.lastUpdatedAt)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border-primary bg-bg-card px-4 py-3">
                <div className="text-xs text-text-muted mb-1">系统映射条目</div>
                <div className="text-2xl font-semibold text-text-primary">{mappedEntityCount}</div>
              </div>
              <div className="rounded-xl border border-border-primary bg-bg-card px-4 py-3">
                <div className="text-xs text-text-muted mb-1">人工维护条目</div>
                <div className="text-2xl font-semibold text-text-primary">{manualEntityCount}</div>
              </div>
            </div>
            <div className="text-xs text-text-secondary leading-5">
              系统映射主要来自任务与财务模块；人工维护用于补充项目知识、说明文档与来源证据。
            </div>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-6">
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.12 }}
          className="space-y-4"
        >
          <Card className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-base font-semibold text-text-primary">知识首页</div>
                <div className="text-sm text-text-secondary mt-1">
                  先查找、再阅读、最后再决定是否进入维护或高级模式。
                </div>
              </div>
              <span className="badge badge-primary">默认浏览优先</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedTypeId('class:task');
                  setIncludeDocuments(false);
                }}
                className="rounded-2xl border border-border-primary bg-bg-secondary px-4 py-3 text-left hover:border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <div className="text-sm font-semibold text-text-primary">查看任务知识映射</div>
                <div className="text-xs text-text-secondary mt-1">
                  聚焦任务自动映射条目，快速检查任务上下文与关联来源。
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedTypeId('class:finance-record');
                  setIncludeDocuments(false);
                }}
                className="rounded-2xl border border-border-primary bg-bg-secondary px-4 py-3 text-left hover:border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <div className="text-sm font-semibold text-text-primary">查看财务知识映射</div>
                <div className="text-xs text-text-secondary mt-1">
                  聚焦财务自动映射条目，快速理解金额、分类和业务上下文。
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedTypeId('all');
                  setIncludeDocuments(true);
                  setSearchQuery('');
                }}
                className="rounded-2xl border border-border-primary bg-bg-secondary px-4 py-3 text-left hover:border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <div className="text-sm font-semibold text-text-primary">浏览人工知识与来源文档</div>
                <div className="text-xs text-text-secondary mt-1">
                  查看人工维护知识条目和关键说明文档，补足智能体上下文。
                </div>
              </button>
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center gap-2 text-text-primary">
              <Search className="w-4 h-4 text-text-secondary" />
              <span className="font-medium">搜索与筛选</span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索知识条目、别名、标签或来源文档..."
                className="input pl-9"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5" />
                  条目类型
                </div>
                <select
                  value={selectedTypeId}
                  onChange={(event) => setSelectedTypeId(event.target.value)}
                  className="input"
                >
                  <option value="all">全部条目类型</option>
                  {dataset.ontology.classes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-xs text-text-muted mb-2">结果范围</div>
                <button
                  type="button"
                  onClick={() => setIncludeDocuments((prev) => !prev)}
                  className={`w-full h-[46px] rounded-[6px] border transition-all ${
                    includeDocuments
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border-primary bg-bg-card text-text-secondary'
                  }`}
                >
                  {includeDocuments ? '包含来源文档' : '仅知识条目'}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedTypeId('all');
                  setIncludeDocuments(true);
                }}
              >
                清空筛选
              </Button>
            </div>
          </Card>

          <Card padding="none" className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border-primary">
              <div className="text-base font-semibold text-text-primary">推荐阅读</div>
              <div className="text-xs text-text-muted mt-1">优先展示人工知识与关键来源文档</div>
            </div>
            <div className="p-3 space-y-2">
              {spotlightItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-primary px-4 py-6 text-sm text-text-muted text-center">
                  还没有可推荐的人工知识或来源文档。
                </div>
              ) : (
                spotlightItems.map((item) => (
                  <button
                    key={`${item.kind}-${item.id}`}
                    type="button"
                    onClick={() => handleSelectSpotlight(item)}
                    className="w-full rounded-xl border border-border-primary bg-bg-secondary px-4 py-3 text-left hover:border-primary/30 hover:bg-primary/5 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text-primary truncate">{item.title}</div>
                        <div className="text-xs text-text-secondary mt-1 line-clamp-2">{item.summary}</div>
                      </div>
                      <span className={`badge ${item.kind === 'document' ? 'badge-warning' : 'badge-primary'}`}>
                        {item.badge}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card padding="none" className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border-primary flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-text-primary">搜索结果</div>
                <div className="text-xs text-text-muted mt-1">
                  {searchLoading ? '正在从服务端检索知识内容...' : `共 ${searchResults.length} 项，默认优先用于查找与阅读`}
                </div>
              </div>
            </div>

            {searchLoading ? (
              <div className="px-5 py-8 text-sm text-text-muted text-center">
                正在检索知识内容...
              </div>
            ) : searchResults.length === 0 ? (
              <EmptyState
                icon={Database}
                title="暂无命中结果"
                description="可以尝试更短的关键词，或切换回全部条目类型。"
              />
            ) : (
              <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">
                {searchResults.map((hit) => {
                  const active = selectedHit?.kind === hit.kind && selectedHit.id === hit.id;
                  return (
                    <button
                      key={`${hit.kind}-${hit.id}`}
                      type="button"
                      onClick={() => setSelectedHit({ kind: hit.kind, id: hit.id })}
                      className={`w-full text-left px-5 py-4 border-b border-border-primary transition-colors ${
                        active ? 'bg-primary/8' : 'hover:bg-bg-secondary'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`badge ${hit.kind === 'entity' ? 'badge-primary' : 'badge-warning'}`}>
                              {getNodeKindLabel(hit.kind, viewMode)}
                            </span>
                            {hit.kind === 'entity' && (() => {
                              const entity = getKnowledgeEntityById(hit.id);
                              return entity ? (
                                <span className={`badge ${getEntityOriginBadgeClass(entity)}`}>
                                  {getEntityOriginMeta(entity).label}
                                </span>
                              ) : null;
                            })()}
                            {hit.typeId && (
                              <span className="text-[11px] text-text-muted truncate">{hit.typeId}</span>
                            )}
                          </div>
                          <div className="text-sm font-medium text-text-primary truncate">{hit.title}</div>
                          <div className="text-xs text-text-secondary mt-1 line-clamp-2">
                            {hit.summary || '暂无摘要。'}
                          </div>
                          {hit.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {hit.tags.slice(0, 3).map((tag) => (
                                <span key={tag} className="badge badge-success">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-[11px] text-text-muted shrink-0">{(1 - hit.score).toFixed(2)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.14 }}
        >
          <Card className="min-h-[720px]">
            {selectedEntity && viewMode !== 'browse' && (
              <div className="flex flex-wrap gap-2 mb-5 pb-5 border-b border-border-primary">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<PencilLine className="w-4 h-4" />}
                  onClick={openEditEntityModal}
                >
                  编辑当前知识条目
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<GitBranchPlus className="w-4 h-4" />}
                  onClick={openRelationModal}
                  disabled={dataset.entities.length < 2}
                >
                  补充关联
                </Button>
                {viewMode === 'advanced' && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Sparkles className="w-4 h-4" />}
                      onClick={() => openCreateAssertionModal({ subjectId: selectedEntity.id })}
                    >
                      为当前知识条目新增事实记录
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 className="w-4 h-4" />}
                      onClick={openDeleteEntityDialog}
                    >
                      删除当前知识条目
                    </Button>
                  </>
                )}
              </div>
            )}

            {selectedDocument && viewMode !== 'browse' && (
              <div className="flex flex-wrap gap-2 mb-5 pb-5 border-b border-border-primary">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<PencilLine className="w-4 h-4" />}
                  onClick={openEditDocumentModal}
                >
                  编辑当前来源文档
                </Button>
                {viewMode === 'advanced' && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Sparkles className="w-4 h-4" />}
                      onClick={() =>
                        openCreateAssertionModal({
                          subjectId: defaultSubjectId,
                          evidenceDocumentIds: [selectedDocument.id],
                        })
                      }
                      disabled={!defaultSubjectId}
                    >
                      以当前文档补充证据事实
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 className="w-4 h-4" />}
                      onClick={openDeleteDocumentDialog}
                    >
                      删除当前来源文档
                    </Button>
                  </>
                )}
              </div>
            )}

            {selectedEntity ? (
              <EntityDetail
                entity={selectedEntity}
                dataset={dataset}
                mode={viewMode}
                onSelectEntity={handleSelectEntity}
                onEditAssertion={openEditAssertionModal}
                onDeleteAssertion={openDeleteAssertionDialog}
                onDeleteRelation={openDeleteRelationDialog}
              />
            ) : selectedDocument ? (
              <DocumentDetail
                document={selectedDocument}
                dataset={dataset}
                mode={viewMode}
                onSelectEntity={handleSelectEntity}
                onEditAssertion={openEditAssertionModal}
                onDeleteAssertion={openDeleteAssertionDialog}
              />
            ) : (
              <EmptyState
                icon={BookOpen}
                title="选择一项查看详情"
                description="左侧可先从推荐阅读、快速入口或搜索结果进入。"
                size="lg"
              />
            )}
          </Card>

          <Card className="space-y-4 mt-6">
            <div>
              <div className="text-base font-semibold text-text-primary">最近更新</div>
              <div className="text-xs text-text-muted mt-1">帮助快速定位最近补充或最近自动同步的知识项</div>
            </div>
            <div className="space-y-2">
              {recentItems.map((item) => (
                <button
                  key={`recent-${item.kind}-${item.id}`}
                  type="button"
                  onClick={() => handleSelectSpotlight(item)}
                  className="w-full rounded-xl border border-border-primary bg-bg-secondary px-4 py-3 text-left hover:border-primary/30 hover:bg-primary/5 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">{item.title}</div>
                      <div className="text-xs text-text-secondary mt-1 line-clamp-1">{item.summary}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`badge ${item.kind === 'document' ? 'badge-warning' : 'badge-primary'}`}>
                        {item.kind === 'document' ? '文档' : '条目'}
                      </div>
                      <div className="text-[11px] text-text-muted mt-1">{formatTimestamp(item.updatedAt)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </motion.div>
      </div>

      <AnimatePresence>
        <OntologyManagerModal
          open={isOntologyManagerOpen}
          activeTab={ontologyTab}
          classForm={ontologyClassForm}
          relationForm={ontologyRelationForm}
          editingClass={editingOntologyClass}
          editingRelation={editingOntologyRelation}
          error={ontologyError}
          saving={savingOntology}
          classes={dataset.ontology.classes}
          relations={dataset.ontology.relations}
          onClose={() => {
            if (!savingOntology) {
              setOntologyManagerOpen(false);
              setOntologyError('');
            }
          }}
          onTabChange={setOntologyTab}
          onClassFormChange={(patch) => setOntologyClassForm((prev) => ({ ...prev, ...patch }))}
          onRelationFormChange={(patch) => setOntologyRelationForm((prev) => ({ ...prev, ...patch }))}
          onCreateClass={() => openOntologyClassEditor()}
          onEditClass={openOntologyClassEditor}
          onDeleteClass={openDeleteOntologyClassDialog}
          onFilterByClass={handleFilterByOntologyClass}
          onSubmitClass={handleOntologyClassSubmit}
          onCreateRelation={() => openOntologyRelationEditor()}
          onEditRelation={openOntologyRelationEditor}
          onDeleteRelation={openDeleteOntologyRelationDialog}
          onFilterByRelation={handleFilterByOntologyRelation}
          onSubmitRelation={handleOntologyRelationSubmit}
        />
      </AnimatePresence>

      <AnimatePresence>
        <KnowledgeCreateGuideModal
          open={isCreateGuideOpen}
          canCreateStructureLink={Boolean(selectedEntity) && dataset.entities.length >= 2}
          onClose={() => setCreateGuideOpen(false)}
          onSelect={handleCreateIntent}
        />
      </AnimatePresence>

      <AnimatePresence>
        <GuidedEntityCreateModal
          open={isGuidedEntityModalOpen}
          intent={(guidedIntent === 'business-note' ? 'business-note' : 'project-note')}
          form={guidedEntityForm}
          error={entityError}
          saving={savingEntity}
          onClose={() => {
            if (!savingEntity) {
              setGuidedEntityModalOpen(false);
              setGuidedIntent(null);
              setEntityError('');
            }
          }}
          onChange={(patch) => setGuidedEntityForm((prev) => ({ ...prev, ...patch }))}
          onSubmit={handleGuidedEntitySubmit}
        />
      </AnimatePresence>

      <AnimatePresence>
        <GuidedDocumentCreateModal
          open={isGuidedDocumentModalOpen}
          intent={(guidedIntent === 'business-note' ? 'business-note' : 'source-document')}
          form={guidedDocumentForm}
          error={documentError}
          saving={savingDocument}
          entityOptions={dataset.entities}
          onClose={() => {
            if (!savingDocument) {
              setGuidedDocumentModalOpen(false);
              setGuidedIntent(null);
              setDocumentError('');
            }
          }}
          onChange={(patch) => setGuidedDocumentForm((prev) => ({ ...prev, ...patch }))}
          onToggleEntity={(entityId) =>
            setGuidedDocumentForm((prev) => ({
              ...prev,
              entityIds: toggleStringInList(prev.entityIds, entityId),
            }))
          }
          onSubmit={handleGuidedDocumentSubmit}
        />
      </AnimatePresence>

      <AnimatePresence>
        <EntityEditorModal
          open={isEntityModalOpen}
          editingEntity={editingEntity}
          intent={entityModalIntent}
          form={entityForm}
          error={entityError}
          saving={savingEntity}
          classOptions={classOptions}
          onClose={() => {
            if (!savingEntity) {
              setEntityModalOpen(false);
              setEditingEntity(null);
              setEntityModalIntent(null);
              setEntityError('');
            }
          }}
          onChange={(patch) => setEntityForm((prev) => ({ ...prev, ...patch }))}
          onSubmit={handleEntitySubmit}
        />
      </AnimatePresence>

      <AnimatePresence>
        <DeleteConfirmModal
          open={Boolean(deleteDialog)}
          title={deleteDialog?.title || '确认删除'}
          description={deleteDialog?.description || ''}
          deleting={deleting}
          confirmLabel={deleteDialog?.confirmLabel || '删除'}
          onClose={() => {
            if (!deleting) {
              setDeleteDialog(null);
            }
          }}
          onConfirm={() => {
            if (!deleteDialog || deleting) {
              return;
            }
            void deleteDialog.onConfirm();
          }}
        />
      </AnimatePresence>

      <AnimatePresence>
        <RelationEditorModal
          open={isRelationModalOpen}
          form={relationForm}
          error={relationError}
          saving={savingRelation}
          relationOptions={relationOptions}
          entityOptions={dataset.entities}
          onClose={() => {
            if (!savingRelation) {
              setRelationModalOpen(false);
              setRelationError('');
            }
          }}
          onChange={(patch) =>
            setRelationForm((prev) => {
              const next = { ...prev, ...patch };
              if (patch.subjectId && next.subjectId === next.targetId) {
                next.targetId =
                  dataset.entities.find((entity) => entity.id !== next.subjectId)?.id || '';
              }
              return next;
            })
          }
          onSubmit={handleRelationSubmit}
        />
      </AnimatePresence>

      <AnimatePresence>
        <DocumentEditorModal
          open={isDocumentModalOpen}
          editingDocument={editingDocument}
          intent={documentModalIntent}
          form={documentForm}
          error={documentError}
          saving={savingDocument}
          entityOptions={dataset.entities}
          onClose={() => {
            if (!savingDocument) {
              setDocumentModalOpen(false);
              setEditingDocument(null);
              setDocumentModalIntent(null);
              setDocumentError('');
            }
          }}
          onChange={(patch) => setDocumentForm((prev) => ({ ...prev, ...patch }))}
          onToggleEntity={(entityId) =>
            setDocumentForm((prev) => ({
              ...prev,
              entityIds: toggleStringInList(prev.entityIds, entityId),
            }))
          }
          onSubmit={handleDocumentSubmit}
        />
      </AnimatePresence>

      <AnimatePresence>
        <DebugDrawer
          open={isDebugDrawerOpen}
          dataset={dataset}
          overview={overview}
          viewMode={viewMode}
          selectedEntity={selectedEntity}
          selectedDocument={selectedDocument}
          selectedTypeId={selectedTypeId}
          includeDocuments={includeDocuments}
          searchQuery={searchQuery}
          mappedEntityCount={mappedEntityCount}
          manualEntityCount={manualEntityCount}
          serverKnowledgeSnapshot={serverKnowledgeSnapshot}
          serverSnapshotError={serverSnapshotError}
          loadingServerSnapshot={loadingServerSnapshot}
          onClose={() => setDebugDrawerOpen(false)}
        />
      </AnimatePresence>

      <AnimatePresence>
        <AssertionEditorModal
          open={isAssertionModalOpen}
          editingAssertion={editingAssertion}
          form={assertionForm}
          error={assertionError}
          saving={savingAssertion}
          entityOptions={dataset.entities}
          relationOptions={relationOptions}
          documentOptions={dataset.documents}
          objectOptions={objectOptions}
          onClose={() => {
            if (!savingAssertion) {
              setAssertionModalOpen(false);
              setEditingAssertion(null);
              setAssertionError('');
            }
          }}
          onChange={(patch) => setAssertionForm((prev) => ({ ...prev, ...patch }))}
          onToggleEvidence={(documentId) =>
            setAssertionForm((prev) => ({
              ...prev,
              evidenceDocumentIds: toggleStringInList(prev.evidenceDocumentIds, documentId),
            }))
          }
          onSubmit={handleAssertionSubmit}
        />
      </AnimatePresence>
    </div>
  );
}
