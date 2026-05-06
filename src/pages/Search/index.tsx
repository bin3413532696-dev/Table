import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CheckSquare,
  Database,
  FileText,
  Filter,
  Search,
  Wallet,
} from 'lucide-react';
import { Button, Card, EmptyState } from '../../components/ui';
import {
  searchAllRemote,
  type UnifiedSearchModule,
  type UnifiedSearchRecord,
} from '../../lib/search';

type ModuleFilterOption = {
  id: UnifiedSearchModule;
  label: string;
  icon: React.ElementType;
  description: string;
};

const moduleOptions: ModuleFilterOption[] = [
  {
    id: 'task',
    label: '任务',
    icon: CheckSquare,
    description: '检索标题、备注、优先级上下文',
  },
  {
    id: 'finance',
    label: '财务',
    icon: Wallet,
    description: '检索描述、分类、模型字段',
  },
  {
    id: 'knowledge',
    label: '知识',
    icon: Database,
    description: '检索实体、文档、摘要与正文',
  },
];

function getModuleBadgeClass(module: UnifiedSearchModule) {
  if (module === 'task') {
    return 'badge-primary';
  }

  if (module === 'finance') {
    return 'badge-success';
  }

  return 'badge-warning';
}

function getModuleLabel(module: UnifiedSearchModule) {
  if (module === 'task') {
    return '任务';
  }

  if (module === 'finance') {
    return '财务';
  }

  return '知识';
}

function getResultKindLabel(item: UnifiedSearchRecord) {
  if (item.module === 'task') {
    return item.metadata.completed ? '已完成任务' : '待办任务';
  }

  if (item.module === 'finance') {
    return item.metadata.type === 'income' ? '收入记录' : '支出记录';
  }

  return item.kind === 'document' ? '知识文档' : '知识实体';
}

function formatTimestamp(timestamp?: number) {
  if (!timestamp) {
    return '未记录';
  }

  return new Date(timestamp).toLocaleString('zh-CN');
}

function buildResultMeta(item: UnifiedSearchRecord) {
  if (item.module === 'task') {
    return [
      `优先级：${item.metadata.priority}`,
      item.metadata.dueDate ? `截止：${item.metadata.dueDate}` : '未设置截止日期',
    ].join(' · ');
  }

  if (item.module === 'finance') {
    return [
      `${item.metadata.type === 'income' ? '收入' : '支出'} ¥${item.metadata.amount.toLocaleString()}`,
      item.metadata.category,
      item.metadata.date,
    ].join(' · ');
  }

  const knowledgeMeta = [
    item.metadata.typeId || getResultKindLabel(item),
    item.metadata.tags.length > 0 ? `标签 ${item.metadata.tags.slice(0, 3).join(' / ')}` : '无标签',
  ];
  return knowledgeMeta.join(' · ');
}

function getResultIcon(item: UnifiedSearchRecord) {
  if (item.module === 'task') {
    return CheckSquare;
  }

  if (item.module === 'finance') {
    return Wallet;
  }

  return item.kind === 'document' ? FileText : BookOpen;
}

function getResultTarget(item: UnifiedSearchRecord) {
  if (item.module === 'task') {
    return '/tasks';
  }

  if (item.module === 'finance') {
    return '/finance';
  }

  return '/knowledge';
}

function getGroupedResults(results: UnifiedSearchRecord[]) {
  return {
    task: results.filter((item) => item.module === 'task'),
    finance: results.filter((item) => item.module === 'finance'),
    knowledge: results.filter((item) => item.module === 'knowledge'),
  };
}

function ResultSection({
  title,
  description,
  items,
  onOpen,
}: {
  title: string;
  description: string;
  items: UnifiedSearchRecord[];
  onOpen: (item: UnifiedSearchRecord) => void;
}) {
  return (
    <div>
      <div className="px-5 py-4 border-b border-border-primary bg-bg-secondary/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">{title}</div>
            <div className="text-xs text-text-muted mt-1">{description}</div>
          </div>
          <span className="badge badge-primary">{items.length}</span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-6 text-sm text-text-muted">当前关键词下暂无该模块结果。</div>
      ) : (
        <div className="divide-y divide-border-primary">
          {items.map((item) => {
            const ResultIcon = getResultIcon(item);
            return (
              <button
                key={`${item.module}-${item.kind}-${item.id}`}
                type="button"
                onClick={() => onOpen(item)}
                className="w-full text-left px-5 py-4 hover:bg-bg-secondary transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-bg-tertiary flex items-center justify-center text-text-secondary shrink-0">
                      <ResultIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className={`badge ${getModuleBadgeClass(item.module)}`}>
                          {getModuleLabel(item.module)}
                        </span>
                        <span className="badge badge-secondary">{getResultKindLabel(item)}</span>
                      </div>
                      <div className="text-sm font-semibold text-text-primary truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-text-secondary mt-1 line-clamp-2">
                        {item.summary || '暂无摘要。'}
                      </div>
                      <div className="text-[11px] text-text-muted mt-2">
                        {buildResultMeta(item)}
                      </div>
                      <div className="text-[11px] text-text-muted mt-1">
                        更新时间：{formatTimestamp(item.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 pl-2">
                    <div className="text-right">
                      <div className="text-xs text-text-muted">排序分</div>
                      <div className="text-sm font-mono text-text-primary">
                        {item.rankingScore.toFixed(2)}
                      </div>
                      <div className="text-[11px] text-text-muted mt-1">
                        原始 {item.score.toFixed(2)}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-text-muted" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedModules, setSelectedModules] = useState<UnifiedSearchModule[]>([
    'task',
    'finance',
    'knowledge',
  ]);
  const [results, setResults] = useState<UnifiedSearchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const resultStats = useMemo(() => {
    return results.reduce(
      (accumulator, item) => {
        accumulator[item.module] += 1;
        return accumulator;
      },
      { task: 0, finance: 0, knowledge: 0 } as Record<UnifiedSearchModule, number>
    );
  }, [results]);

  const groupedResults = useMemo(() => getGroupedResults(results), [results]);

  useEffect(() => {
    let disposed = false;

    const runSearch = async () => {
      setLoading(true);
      setError('');

      try {
        const items = await searchAllRemote(query, {
          modules: selectedModules,
          limit: 20,
          includeKnowledgeDocuments: true,
        });

        if (!disposed) {
          setResults(items);
        }
      } catch (nextError) {
        if (!disposed) {
          setResults([]);
          setError(nextError instanceof Error ? nextError.message : '统一搜索失败。');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void runSearch();

    return () => {
      disposed = true;
    };
  }, [query, selectedModules]);

  const toggleModule = (moduleId: UnifiedSearchModule) => {
    setSelectedModules((current) => {
      if (current.includes(moduleId)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((item) => item !== moduleId);
      }

      return [...current, moduleId];
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="page-header"
      >
        <div className="page-header-icon">
          <Search className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="page-header-title">全局搜索</h1>
          <p className="page-header-subtitle">跨任务、财务、知识的一站式检索入口</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-5 md:gap-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="space-y-5"
        >
          <Card className="space-y-5">
            <div>
              <div className="text-base font-semibold text-text-primary">检索条件</div>
              <div className="text-xs text-text-muted mt-1">
                统一搜索会按模块聚合结果，并优先展示匹配度更高的内容。
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入关键词，例如：报销、延期、架构、工作站"
                className="input pl-10"
              />
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-3">
                <Filter className="w-4 h-4" />
                搜索范围
              </div>
              <div className="space-y-2">
                {moduleOptions.map((option) => {
                  const active = selectedModules.includes(option.id);
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleModule(option.id)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                        active
                          ? 'border-primary bg-primary/10'
                          : 'border-border-primary bg-bg-card hover:border-primary/30 hover:bg-primary/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                              active ? 'bg-primary text-white' : 'bg-bg-tertiary text-text-secondary'
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-text-primary">{option.label}</div>
                            <div className="text-xs text-text-muted mt-1">{option.description}</div>
                          </div>
                        </div>
                        <span className={`badge ${getModuleBadgeClass(option.id)}`}>
                          {resultStats[option.id]}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card className="space-y-3">
            <div className="text-base font-semibold text-text-primary">当前状态</div>
            <div className="text-sm text-text-secondary">
              {loading
                ? '正在从服务端聚合任务、财务和知识结果...'
                : `当前返回 ${results.length} 条结果，范围覆盖 ${selectedModules.length} 个模块。`}
            </div>
            <div className="text-xs text-text-muted leading-5">
              第一版统一搜索已接入服务端 FTS，但各模块页暂未共享同一搜索输入状态，跳转后默认进入对应模块主页。
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
        >
          <Card padding="none" className="overflow-hidden min-h-[720px]">
            <div className="px-5 py-4 border-b border-border-primary flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-text-primary">搜索结果</div>
                <div className="text-xs text-text-muted mt-1">
                  {loading ? '正在检索...' : `共 ${results.length} 项，按匹配度与更新时间混合排序`}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                清空关键词
              </Button>
            </div>

            {loading ? (
              <div className="px-5 py-10 text-sm text-text-muted text-center">正在执行统一搜索...</div>
            ) : error ? (
              <div className="px-5 py-10 text-sm text-error text-center">{error}</div>
            ) : results.length === 0 ? (
              <EmptyState
                icon={Search}
                title="暂无命中结果"
                description="可以尝试更短的关键词，或扩大搜索模块范围。"
                size="lg"
              />
            ) : (
              <div className="divide-y divide-border-primary">
                <ResultSection
                  title="任务结果"
                  description="优先展示标题强命中和近期更新的待办内容。"
                  items={groupedResults.task}
                  onOpen={(item) => navigate(getResultTarget(item))}
                />
                <ResultSection
                  title="财务结果"
                  description="描述、分类、模型命中后会参与统一排序。"
                  items={groupedResults.finance}
                  onOpen={(item) => navigate(getResultTarget(item))}
                />
                <ResultSection
                  title="知识结果"
                  description="实体与文档统一参与排序，并保留知识类标签信息。"
                  items={groupedResults.knowledge}
                  onOpen={(item) => navigate(getResultTarget(item))}
                />
              </div>
            )}
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
