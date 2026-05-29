import { createJob, updateJobStatus, findJobById, findStaleJobs, resetStaleJobs, findPendingJobs } from '../repository';
import type { IndexJobRecord } from '../repository';
import { ragConfig } from '../config';

// =====================================================
// 任务优先级定义
// =====================================================
export type JobPriority = 'high' | 'normal' | 'low';

const PRIORITY_VALUES: Record<JobPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

// =====================================================
// 任务队列配置
// =====================================================
const QUEUE_CONFIG = {
  maxConcurrent: ragConfig.INDEX_BATCH_SIZE || 3,
  staleTimeoutMinutes: 30,
  pollIntervalMs: 5000, // 5秒轮询一次待处理任务
  gracefulShutdownTimeoutMs: 30000, // 30秒优雅关闭超时
};

// =====================================================
// 持久化任务队列管理器
// =====================================================
export class PersistentJobQueue {
  private activeJobs: Map<string, { promise: Promise<void>; abortController: AbortController }> = new Map();
  private isShuttingDown = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private processingLoop: Promise<void> | null = null;

  constructor() {
    // 启动时恢复超时任务
    this.recoverStaleJobs();
    // 启动后台轮询
    this.startBackgroundPolling();
  }

  // =====================================================
  // 任务入队
  // =====================================================
  async enqueue(
    documentId: string,
    jobType: string,
    priority: JobPriority = 'normal'
  ): Promise<IndexJobRecord> {
    if (this.isShuttingDown) {
      throw new Error('队列正在关闭，无法接受新任务');
    }

    const job = await createJob(documentId, jobType);
    console.log(`[JobQueue] 任务入队: ${job.id}, documentId=${documentId}, type=${jobType}, priority=${priority}`);

    // 触发立即处理（不等待轮询）
    this.processNextJob();

    return job;
  }

  // =====================================================
  // 任务状态管理
  // =====================================================
  async markRunning(jobId: string): Promise<void> {
    await updateJobStatus(jobId, 'running', 0);
  }

  async updateProgress(jobId: string, progress: number): Promise<void> {
    await updateJobStatus(jobId, 'running', Math.min(100, Math.max(0, progress)));
  }

  async markCompleted(jobId: string): Promise<void> {
    await updateJobStatus(jobId, 'completed', 100);
    this.activeJobs.delete(jobId);
    console.log(`[JobQueue] 任务完成: ${jobId}`);

    // 任务完成后立即处理下一个
    this.processNextJob();
  }

  async markFailed(jobId: string, error: unknown): Promise<void> {
    const errorInfo = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };

    await updateJobStatus(jobId, 'failed', undefined, errorInfo);
    this.activeJobs.delete(jobId);
    console.error(`[JobQueue] 任务失败: ${jobId}`, errorInfo.message);

    // 任务失败后立即处理下一个
    this.processNextJob();
  }

  async getStatus(jobId: string): Promise<IndexJobRecord | null> {
    return findJobById(jobId);
  }

  // =====================================================
  // 后台轮询机制
  // =====================================================
  private startBackgroundPolling(): void {
    this.pollTimer = setInterval(() => {
      if (!this.isShuttingDown && this.activeJobs.size < QUEUE_CONFIG.maxConcurrent) {
        this.processNextJob();
      }
    }, QUEUE_CONFIG.pollIntervalMs);

    console.log(`[JobQueue] 后台轮询启动，间隔 ${QUEUE_CONFIG.pollIntervalMs}ms`);
  }

  private stopBackgroundPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[JobQueue] 后台轮询停止');
    }
  }

  // =====================================================
  // 任务处理
  // =====================================================
  private async processNextJob(): Promise<void> {
    if (this.isShuttingDown) return;
    if (this.activeJobs.size >= QUEUE_CONFIG.maxConcurrent) return;

    try {
      // 从数据库获取待处理任务（按优先级排序）
      const pendingJobs = await findPendingJobs(QUEUE_CONFIG.maxConcurrent - this.activeJobs.size);

      if (pendingJobs.length === 0) return;

      for (const job of pendingJobs) {
        if (this.activeJobs.size >= QUEUE_CONFIG.maxConcurrent) break;
        if (this.activeJobs.has(job.id)) continue;

        // 创建 AbortController 用于优雅关闭
        const abortController = new AbortController();

        console.log(`[JobQueue] 开始处理任务: ${job.id}`);
      }
    } catch (error) {
      console.error('[JobQueue] 获取待处理任务失败:', error);
    }
  }

  // =====================================================
  // 超时任务恢复
  // =====================================================
  private async recoverStaleJobs(): Promise<void> {
    console.log('[JobQueue] 检查超时任务...');
    const staleJobs = await findStaleJobs(QUEUE_CONFIG.staleTimeoutMinutes);

    if (staleJobs.length > 0) {
      console.warn(`[JobQueue] 发现 ${staleJobs.length} 个超时任务，正在重置...`);
      const count = await resetStaleJobs(QUEUE_CONFIG.staleTimeoutMinutes);
      console.log(`[JobQueue] 已重置 ${count} 个超时任务`);
    }
  }

  // =====================================================
  // 优雅关闭
  // =====================================================
  async shutdown(): Promise<void> {
    console.log('[JobQueue] 开始优雅关闭...');
    this.isShuttingDown = true;
    this.stopBackgroundPolling();

    // 等待所有活跃任务完成
    const activePromises = Array.from(this.activeJobs.values()).map(j => j.promise);

    if (activePromises.length > 0) {
      console.log(`[JobQueue] 等待 ${activePromises.length} 个活跃任务完成...`);

      try {
        await Promise.race([
          Promise.all(activePromises),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('优雅关闭超时')), QUEUE_CONFIG.gracefulShutdownTimeoutMs)
          ),
        ]);
        console.log('[JobQueue] 所有活跃任务已完成');
      } catch (error) {
        console.warn('[JobQueue] 优雅关闭超时，强制终止剩余任务');
        // 中止所有活跃任务
        for (const { abortController } of this.activeJobs.values()) {
          abortController.abort();
        }
      }
    }

    this.activeJobs.clear();
    console.log('[JobQueue] 关闭完成');
  }

  // =====================================================
  // 队列状态
  // =====================================================
  getQueueStats(): {
    activeCount: number;
    maxConcurrent: number;
    isShuttingDown: boolean;
  } {
    return {
      activeCount: this.activeJobs.size,
      maxConcurrent: QUEUE_CONFIG.maxConcurrent,
      isShuttingDown: this.isShuttingDown,
    };
  }
}

// =====================================================
// 单例实例
// =====================================================
let jobQueueInstance: PersistentJobQueue | null = null;

export function getJobQueue(): PersistentJobQueue {
  if (!jobQueueInstance) {
    jobQueueInstance = new PersistentJobQueue();
  }
  return jobQueueInstance;
}

// 优雅关闭函数（供应用 shutdown hook 使用）
export async function shutdownJobQueue(): Promise<void> {
  if (jobQueueInstance) {
    await jobQueueInstance.shutdown();
    jobQueueInstance = null;
  }
}

// =====================================================
// 简化接口（向后兼容）
// =====================================================
export class JobQueue {
  private queue: PersistentJobQueue;

  constructor() {
    this.queue = getJobQueue();
  }

  async enqueue(documentId: string, jobType: string): Promise<IndexJobRecord> {
    return this.queue.enqueue(documentId, jobType);
  }

  async markRunning(jobId: string): Promise<void> {
    return this.queue.markRunning(jobId);
  }

  async updateProgress(jobId: string, progress: number): Promise<void> {
    return this.queue.updateProgress(jobId, progress);
  }

  async markCompleted(jobId: string): Promise<void> {
    return this.queue.markCompleted(jobId);
  }

  async markFailed(jobId: string, error: unknown): Promise<void> {
    return this.queue.markFailed(jobId, error);
  }

  async getStatus(jobId: string): Promise<IndexJobRecord | null> {
    return this.queue.getStatus(jobId);
  }
}

export const jobQueue = new JobQueue();