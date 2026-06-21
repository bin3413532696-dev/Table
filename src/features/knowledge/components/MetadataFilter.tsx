import React from 'react';
import { Filter, X, Calendar, Building2, Shield, FolderOpen } from 'lucide-react';
import type { MetadataFilter as MetadataFilterType, SecurityLevel } from '../types';

interface MetadataFilterProps {
  filters: MetadataFilterType;
  onChange: (filters: MetadataFilterType) => void;
}

const DEPT_OPTIONS = [
  '技术部', '财务部', '人力资源部', '市场部',
  '运营部', '法务部', '行政部', '产品部', '战略部',
];

const CATEGORY_OPTIONS = [
  '规章制度', '技术文档', '财务报告', '会议纪要',
  '合同协议', '通知公告', '操作手册', '项目文档',
  '培训资料', '研究报告',
];

const SECURITY_OPTIONS: { value: SecurityLevel; label: string; color: string }[] = [
  { value: 'public', label: '公开', color: 'bg-green-100 text-green-700' },
  { value: 'internal', label: '内部', color: 'bg-blue-100 text-blue-700' },
  { value: 'confidential', label: '机密', color: 'bg-orange-100 text-orange-700' },
  { value: 'secret', label: '绝密', color: 'bg-red-100 text-red-700' },
];

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

      {expanded && (
        <div className="bg-white border rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                发布日期
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  value={filters.publishDateRange?.start || ''}
                  onChange={(e) => setDateRange('start', e.target.value)}
                  className="flex-1 px-3 py-1.5 border rounded text-sm"
                />
                <span className="text-gray-400">至</span>
                <input
                  type="date"
                  value={filters.publishDateRange?.end || ''}
                  onChange={(e) => setDateRange('end', e.target.value)}
                  className="flex-1 px-3 py-1.5 border rounded text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-1">
                <Shield className="w-4 h-4" />
                保密等级
              </label>
              <div className="flex gap-2 flex-wrap">
                {SECURITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSecurityLevel(opt.value)}
                    className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                      filters.securityLevel === opt.value
                        ? `${opt.color} border-current`
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-1">
              <Building2 className="w-4 h-4" />
              来源部门
            </label>
            <div className="flex gap-2 flex-wrap">
              {DEPT_OPTIONS.map((dept) => {
                const selected = filters.sourceDept?.includes(dept);
                return (
                  <button
                    key={dept}
                    onClick={() => toggleDept(dept)}
                    className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                      selected
                        ? 'bg-blue-100 text-blue-700 border-blue-300'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {dept}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-1">
              <FolderOpen className="w-4 h-4" />
              业务分类
            </label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORY_OPTIONS.map((cat) => {
                const selected = filters.businessCategory?.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                      selected
                        ? 'bg-green-100 text-green-700 border-green-300'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
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

export function MetadataBadges({ doc }: { doc: { publishDate?: number | null; sourceDept?: string | null; securityLevel?: string | null; businessCategory?: string | null } }) {
  const items = [
    doc.publishDate ? new Date(doc.publishDate).toLocaleDateString('zh-CN') : null,
    doc.sourceDept,
    doc.securityLevel,
    doc.businessCategory,
  ].filter(Boolean);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((item) => (
        <span key={item} className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
          {item}
        </span>
      ))}
    </div>
  );
}
