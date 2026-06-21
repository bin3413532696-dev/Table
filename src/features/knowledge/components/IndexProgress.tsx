import React from 'react';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import type { IndexJob } from '../../../features/knowledge/types';
import * as api from '../../../features/knowledge/api/rag';

interface IndexProgressProps {
  documentId: string;
  onComplete?: () => void;
}

const statusLabels: Record<string, string> = {
  pending: '等待处理',
  running: '正在处理',
  completed: '已完成',
  failed: '处理失败',
};

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="w-4 h-4 text-gray-400" />,
  running: <Loader2 className="w-4 h-4 animate-spin text-blue-500" />,
  completed: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
};

export function IndexProgress({ documentId, onComplete }: IndexProgressProps) {
  const [jobs, setJobs] = React.useState<IndexJob[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [completedCalled, setCompletedCalled] = React.useState(false);
  const [finalStatus, setFinalStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    // 创建 AbortController 用于取消请求
    const abortController = new AbortController();
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const loadJobs = async () => {
      try {
        // 注意：api.getJobs 需要支持 signal 参数才能真正取消请求
        // 这里先做标记，实际取消逻辑需要在 api.ts 中实现
        const result = await api.getJobs({ documentId, limit: 5 });

        // 检查是否已取消
        if (abortController.signal.aborted) return;

        setJobs(result.items);

        const latestJob = result.items[0];
        if (latestJob) {
          // 如果任务已完成或失败，停止轮询
          if (latestJob.status === 'completed' || latestJob.status === 'failed') {
            setFinalStatus(latestJob.status);
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = null;
            }
            // 只调用一次 onComplete
            if (latestJob.status === 'completed' && onComplete && !completedCalled) {
              setCompletedCalled(true);
              onComplete();
            }
          }
        }

        setLoading(false);
      } catch (err) {
        if (abortController.signal.aborted) return;
        console.error('加载任务失败:', err);
      }
    };

    // 初始加载
    loadJobs();

    // 只在未完成时轮询
    if (!finalStatus) {
      intervalId = setInterval(loadJobs, 3000);
    }

    // 清理：取消请求和停止轮询
    return () => {
      abortController.abort();
      if (intervalId) clearInterval(intervalId);
    };
  }, [documentId, onComplete, completedCalled, finalStatus]);

  if (loading) return null;

  if (jobs.length === 0) return null;

  const latestJob = jobs[0];
  const completedWithWarning = latestJob.status === 'completed' && Boolean(latestJob.error);
  const errorMessage =
    latestJob.error && typeof latestJob.error.message === 'string'
      ? latestJob.error.message
      : latestJob.error
        ? JSON.stringify(latestJob.error)
        : null;

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {statusIcons[latestJob.status]}
          <span className="text-sm font-medium text-gray-700">
            索引任务: {completedWithWarning ? '已完成' : statusLabels[latestJob.status]}
          </span>
        </div>
        {latestJob.status === 'running' && (
          <span className="text-sm text-gray-500">{latestJob.progress}%</span>
        )}
      </div>

      {/* Progress Bar */}
      {latestJob.status === 'running' && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${latestJob.progress}%` }}
          />
        </div>
      )}

      {/* Job Details */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>任务类型: {latestJob.jobType}</p>
        <p>创建时间: {new Date(latestJob.createdAt).toLocaleString()}</p>
        {latestJob.startedAt && (
          <p>开始时间: {new Date(latestJob.startedAt).toLocaleString()}</p>
        )}
        {latestJob.completedAt && (
          <p>完成时间: {new Date(latestJob.completedAt).toLocaleString()}</p>
        )}
        {errorMessage && (
          <p className={completedWithWarning ? 'text-amber-600' : 'text-red-600'}>
            {completedWithWarning ? `警告: ${errorMessage}` : `错误: ${errorMessage}`}
          </p>
        )}
      </div>
    </div>
  );
}
