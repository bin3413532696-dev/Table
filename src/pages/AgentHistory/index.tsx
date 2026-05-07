import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, ChevronLeft, AlertCircle } from 'lucide-react';
import {
  fetchAgentRunList,
  fetchAgentRunDetail,
  deleteAgentRunApi,
  type AgentRunDto,
  type AgentRunDetailDto,
} from '../../lib/agentApi';
import { useAgent } from '../../agent/AgentContext';
import { RunList, RunDetail } from './components';
import { Button } from '../../components/ui';
import Loading from '../../components/Loading';

const PAGE_SIZE = 20;

export default function AgentHistory() {
  const { loadHistoryRun } = useAgent();
  const [runs, setRuns] = useState<AgentRunDto[]>([]);
  const [selectedRun, setSelectedRun] = useState<AgentRunDetailDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ offset: 0, total: 0, hasMore: false });

  // 加载会话列表
  const loadRuns = useCallback(async (offset: number = 0) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchAgentRunList({ limit: PAGE_SIZE, offset });
      setRuns(offset === 0 ? result.items : [...runs, ...result.items]);
      setPagination({
        offset,
        total: result.total,
        hasMore: offset + result.items.length < result.total,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [runs]);

  // 初始加载
  useEffect(() => {
    loadRuns();
  }, []);

  // 选择会话查看详情
  const handleSelectRun = async (run: AgentRunDto) => {
    setIsLoadingDetail(true);
    try {
      const detail = await fetchAgentRunDetail(run.id);
      setSelectedRun(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载详情失败');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // 删除会话
  const handleDeleteRun = async (runId: string) => {
    if (!confirm('确定要删除这条对话记录吗？')) {
      return;
    }

    try {
      await deleteAgentRunApi(runId);
      setRuns(runs.filter((r) => r.id !== runId));
      if (selectedRun?.id === runId) {
        setSelectedRun(null);
      }
      setPagination((prev) => ({ ...prev, total: prev.total - 1 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 继续对话（打开 AgentPanel）
  const handleContinue = () => {
    if (selectedRun) {
      loadHistoryRun(selectedRun);
      // 清空选中，返回列表
      setSelectedRun(null);
    }
  };

  // 加载更多
  const handleLoadMore = () => {
    if (!pagination.hasMore || isLoading) return;
    loadRuns(pagination.offset + PAGE_SIZE);
  };

  // 返回列表
  const handleBack = () => {
    setSelectedRun(null);
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto min-h-screen bg-bg-secondary">
      {/* 页面头部 */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="page-header mb-6"
      >
        <div className="page-header-icon">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="page-header-title">对话历史</h1>
          <p className="page-header-subtitle">查看和管理与智能体的对话记录</p>
        </div>
      </motion.div>

      {/* 错误提示 */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-4 rounded-lg bg-red-500/10 text-red-500 flex items-center gap-2"
        >
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto">
            关闭
          </Button>
        </motion.div>
      )}

      {/* 主内容区 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左侧列表 */}
        <div className={`card ${selectedRun ? 'hidden lg:block' : ''}`}>
          <div className="p-4 border-b border-border">
            <h2 className="text-lg font-medium text-text-primary">
              会话列表
              {pagination.total > 0 && (
                <span className="text-sm text-text-secondary font-normal ml-2">
                  共 {pagination.total} 条
                </span>
              )}
            </h2>
          </div>

          <div className="p-4 max-h-[calc(100vh-280px)] overflow-y-auto">
            {isLoading && runs.length === 0 ? (
              <Loading />
            ) : (
              <>
                <RunList
                  runs={runs}
                  selectedId={selectedRun?.id}
                  onSelect={handleSelectRun}
                  onDelete={handleDeleteRun}
                  isLoading={isLoadingDetail}
                />

                {pagination.hasMore && (
                  <div className="mt-4 text-center">
                    <Button variant="secondary" onClick={handleLoadMore} disabled={isLoading}>
                      {isLoading ? '加载中...' : '加载更多'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 右侧详情 */}
        <div className={`card lg:col-span-2 ${!selectedRun ? 'hidden lg:block' : ''}`}>
          {selectedRun ? (
            <RunDetail
              run={selectedRun}
              onContinue={handleContinue}
              onDelete={() => handleDeleteRun(selectedRun.id)}
              isLoading={isLoadingDetail}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
              <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
              <p>选择一条对话记录查看详情</p>
            </div>
          )}
        </div>
      </div>

      {/* 移动端返回按钮 */}
      {selectedRun && (
        <Button
          variant="ghost"
          onClick={handleBack}
          className="lg:hidden fixed bottom-4 left-4 z-10"
          icon={<ChevronLeft className="w-4 h-4" />}
        >
          返回列表
        </Button>
      )}
    </div>
  );
}