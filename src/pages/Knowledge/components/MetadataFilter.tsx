import React from 'react';
import { Filter, X, Calendar, Building2, Shield, FolderOpen } from 'lucide-react';
import type { MetadataFilter as MetadataFilterType, SecurityLevel } from '../../KnowledgeRag/types';

interface MetadataFilterProps {
  filters: MetadataFilterType;
  onChange: (filters: MetadataFilterType) => void;
}

// 预设来源部门
const DEPT_OPTIONS = [
  '技术部', '财务部', '人力资源部', '市场部',
  '运营部', '法务部', '行政部', '产品部', '战略部',
];

// 预设业务分类
const CATEGORY_OPTIONS = [
  '规章制度', '技术文档', '财务报告', '会议纪要',
  '合同协议', '通知公告', '操作手册', '项目文档',
  '培训资料', '研究报告',
];

// 保密等级
const SECURITY_OPTIONS: { value: SecurityLevel; label: string; color: string }[] = [
  { value: 'public', label: '公开', color: 'bg-green-100 text-green-700' },
  { value: 'internal', label: '内部', color: 'bg-blue-100 text-blue-700' },
  { value: 'confidential', label: '机密', color: 'bg-orange-100 text-orange-700' },
  { value: 'secret', label: '绝密', color: 'bg-red-100 text-red-700' },
];

// 检查是否有任何过滤条件激活
function hasActiveFilters(filters: MetadataFilterType): boolean {
  return Boolean(
    filters.publishDateRange?.start ||
    filters.publishDateRange?.end ||
    (filters.sourceDept && filters.sourceDept.length > 0) ||
    filters.securityLevel ||
    (filters.businessCategory && filters.businessCategory.length > 0)
  );
}

export function MetadataFilter({ filters, onChange }: MetadataFilterProps) {
  const [expanded, setExpanded] = React.useState(false);
  const active = hasActiveFilters(filters);

  const activeCount = [
    filters.publishDateRange?.start || filters.publishDateRange?.end ? 1 : 0,
    filters.sourceDept?.length ? 1 : 0,
    filters.securityLevel ? 1 : 0,
    filters.businessCategory?.length ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearAll = () => {
    onChange({});
  };

  const toggleDept = (dept: string) => {
    const current = filters.sourceDept || [];
    const next = current.includes(dept)
      ? current.filter(d => d !== dept)
      : [...current, dept];
    onChange({ ...filters, sourceDept: next.length > 0 ? next : undefined });
  };

  const toggleCategory = (cat: string) => {
    const current = filters.businessCategory || [];
    const next = current.includes(cat)
      ? current.filter(c => c !== cat)
      : [...current, cat];
    onChange({ ...filters, businessCategory: next.length > 0 ? next : undefined });
  };

  const setSecurityLevel = (level: SecurityLevel | undefined) => {
    onChange({ ...filters, securityLevel: filters.securityLevel === level ? undefined : level });
  };

  const setDateRange = (field: 'start' | 'end', value: string) => {
    const current = filters.publishDateRange || {};
    const next = { ...current, [field]: value || undefined };
    if (!next.start && !next.end) {
      onChange({ ...filters, publishDateRange: undefined });
    } else {
      onChange({ ...filters, publishDateRange: next });
    }
  };

  return (
    <div className="space-y-2">
      {/* 触发按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            active
              ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Filter className="w-4 h-4" />
          筛选
          {activeCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-purple-600 text-white text-xs rounded-full">
              {activeCount}
            </span>
          )}
        </button>

        {active && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
          >
            <X className="w-3 h-3" />
            清除筛选
          </button>
        )}
      </div>

      {/* 筛选面板 */}
      {expanded && (
        <div className="p-4 bg-gray-50 rounded-lg border space-y-4">
          {/* 发布日期 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-gray-700">
              <Calendar className="w-4 h-4" />
              发布日期
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filters.publishDateRange?.start || ''}
                onChange={(e) => setDateRange('start', e.target.value)}
                className="px-2 py-1.5 text-sm border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
              <span className="text-gray-400 text-sm">至</span>
              <input
                type="date"
                value={filters.publishDateRange?.end || ''}
                onChange={(e) => setDateRange('end', e.target.value)}
                className="px-2 py-1.5 text-sm border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* 来源部门 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-gray-700">
              <Building2 className="w-4 h-4" />
              来源部门
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DEPT_OPTIONS.map(dept => {
                const selected = filters.sourceDept?.includes(dept);
                return (
                  <button
                    key={dept}
                    onClick={() => toggleDept(dept)}
                    className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                      selected
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-600 border hover:bg-blue-50 hover:border-blue-300'
                    }`}
                  >
                    {dept}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 保密等级 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-gray-700">
              <Shield className="w-4 h-4" />
              保密等级
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SECURITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSecurityLevel(opt.value)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                    filters.securityLevel === opt.value
                      ? opt.color + ' ring-2 ring-offset-1 ring-purple-400'
                      : 'bg-white text-gray-600 border hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 业务分类 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-gray-700">
              <FolderOpen className="w-4 h-4" />
              业务分类
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_OPTIONS.map(cat => {
                const selected = filters.businessCategory?.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                      selected
                        ? 'bg-purple-600 text-white'
                        : 'bg-white text-gray-600 border hover:bg-purple-50 hover:border-purple-300'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 元数据标签展示组件（用于文档卡片/搜索结果）
export function MetadataBadges({ doc }: { doc: {
  publishDate?: number | null;
  sourceDept?: string | null;
  securityLevel?: string | null;
  businessCategory?: string | null;
  hasOcr?: boolean;
  parseQuality?: string | null;
} }) {
  const badges: { label: string; color: string }[] = [];

  if (doc.sourceDept) {
    badges.push({ label: doc.sourceDept, color: 'bg-blue-50 text-blue-600' });
  }

  if (doc.publishDate) {
    const dateStr = new Date(doc.publishDate).toISOString().split('T')[0];
    badges.push({ label: dateStr, color: 'bg-gray-50 text-gray-600' });
  }

  if (doc.businessCategory) {
    badges.push({ label: doc.businessCategory, color: 'bg-purple-50 text-purple-600' });
  }

  if (doc.securityLevel) {
    const slMap: Record<string, { label: string; color: string }> = {
      'public': { label: '公开', color: 'bg-green-50 text-green-600' },
      'internal': { label: '内部', color: 'bg-blue-50 text-blue-600' },
      'confidential': { label: '机密', color: 'bg-orange-50 text-orange-600' },
      'secret': { label: '绝密', color: 'bg-red-50 text-red-600' },
    };
    const sl = slMap[doc.securityLevel];
    if (sl) badges.push({ label: sl.label, color: sl.color });
  }

  if (doc.hasOcr) {
    badges.push({ label: 'OCR', color: 'bg-amber-50 text-amber-600' });
  }

  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge, i) => (
        <span key={i} className={`px-1.5 py-0.5 text-[10px] rounded ${badge.color}`}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}