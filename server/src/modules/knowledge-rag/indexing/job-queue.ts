import { createJob, updateJobStatus, findJobById } from '../repository';
import type { IndexJobRecord } from '../repository';

// 任务队列管理器
export class JobQueue {
  // 创建索引任务
  async enqueue(documentId: string, jobType: string): Promise<IndexJobRecord> {
    return createJob(documentId, jobType);
  }

  // 标记任务开始
  async markRunning(jobId: string): Promise<void> {
    await updateJobStatus(jobId, 'running', 0);
  }

  // 更新任务进度
  async updateProgress(jobId: string, progress: number): Promise<void> {
    await updateJobStatus(jobId, 'running', Math.min(100, Math.max(0, progress)));
  }

  // 标记任务完成
  async markCompleted(jobId: string): Promise<void> {
    await updateJobStatus(jobId, 'completed', 100);
  }

  // 标记任务失败
  async markFailed(jobId: string, error: unknown): Promise<void> {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };

    await updateJobStatus(jobId, 'failed', undefined, errorInfo);
  }

  // 获取任务状态
  async getStatus(jobId: string): Promise<IndexJobRecord | null> {
    return findJobById(jobId);
  }
}

export const jobQueue = new JobQueue();