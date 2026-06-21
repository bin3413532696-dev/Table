import React from 'react';
import Select from '../../../components/ui/Select';
import type { KnowledgeCorpus } from '../../../features/knowledge/types';

interface CorpusManagerProps {
  corpora: KnowledgeCorpus[];
  currentCorpusId: string;
  creating: boolean;
  onSelectCorpus: (corpusId: string) => void;
  onCreateCorpus: (name: string) => Promise<void>;
}

export function CorpusManager({
  corpora,
  currentCorpusId,
  creating,
  onSelectCorpus,
  onCreateCorpus,
}: CorpusManagerProps) {
  const [newCorpusName, setNewCorpusName] = React.useState('');

  const handleCreate = async () => {
    const trimmed = newCorpusName.trim();
    if (!trimmed) {
      return;
    }
    await onCreateCorpus(trimmed);
    setNewCorpusName('');
  };

  return (
    <div className="bg-white rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">资料集</h3>
          <p className="text-xs text-gray-500">把相关 PDF 归到同一个教材集，后续 Agent 会优先在该集合内检索。</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <Select
          value={currentCorpusId}
          onChange={(e) => onSelectCorpus(e.target.value)}
        >
          <option value="">全部文档</option>
          {corpora.map((corpus) => (
            <option key={corpus.id} value={corpus.id}>
              {corpus.name} ({corpus.documentIds.length})
            </option>
          ))}
        </Select>

        <div className="flex gap-2">
          <input
            value={newCorpusName}
            onChange={(e) => setNewCorpusName(e.target.value)}
            placeholder="新资料集名称"
            className="input min-w-0"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newCorpusName.trim()}
            className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {creating ? '创建中...' : '新建'}
          </button>
        </div>
      </div>
    </div>
  );
}
