/**
 * 统一错误处理
 */

/**
 * 错误代码枚举
 */
export enum ErrorCode {
  // 验证错误
  INVALID_ID = 'INVALID_ID',
  INVALID_DATA = 'INVALID_DATA',
  VALIDATION_FAILED = 'VALIDATION_FAILED',

  // 存储错误
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',
  STORAGE_WRITE_FAILED = 'STORAGE_WRITE_FAILED',
  STORAGE_READ_FAILED = 'STORAGE_READ_FAILED',

  // 同步错误
  SYNC_FAILED = 'SYNC_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',

  // 业务错误
  ENTITY_NOT_FOUND = 'ENTITY_NOT_FOUND',
  DUPLICATE_ENTITY = 'DUPLICATE_ENTITY',
  OPERATION_CANCELLED = 'OPERATION_CANCELLED',
}

/**
 * 错误消息映射
 */
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.INVALID_ID]: '无效的 ID 格式',
  [ErrorCode.INVALID_DATA]: '无效的数据格式',
  [ErrorCode.VALIDATION_FAILED]: '数据验证失败',
  [ErrorCode.STORAGE_QUOTA_EXCEEDED]: '存储空间不足',
  [ErrorCode.STORAGE_WRITE_FAILED]: '写入存储失败',
  [ErrorCode.STORAGE_READ_FAILED]: '读取存储失败',
  [ErrorCode.SYNC_FAILED]: '数据同步失败',
  [ErrorCode.NETWORK_ERROR]: '网络请求失败',
  [ErrorCode.ENTITY_NOT_FOUND]: '实体不存在',
  [ErrorCode.DUPLICATE_ENTITY]: '实体已存在',
  [ErrorCode.OPERATION_CANCELLED]: '操作已取消',
};

/**
 * 应用错误类
 */
export class AppError extends Error {
  public readonly timestamp: number;

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly cause?: Error,
    public readonly context?: string
  ) {
    super(message);
    this.name = 'AppError';
    this.timestamp = Date.now();
  }

  /**
   * 从错误代码创建错误实例
   */
  static fromCode(code: ErrorCode, context?: string, cause?: Error): AppError {
    const baseMessage = ERROR_MESSAGES[code];
    const message = context ? `${baseMessage}: ${context}` : baseMessage;
    return new AppError(code, message, cause, context);
  }

  /**
   * 判断是否为存储配额错误
   */
  isQuotaError(): boolean {
    return this.code === ErrorCode.STORAGE_QUOTA_EXCEEDED;
  }

  /**
   * 判断是否为网络错误
   */
  isNetworkError(): boolean {
    return this.code === ErrorCode.NETWORK_ERROR || this.code === ErrorCode.SYNC_FAILED;
  }

  /**
   * 转换为 JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      cause: this.cause?.message,
    };
  }
}

/**
 * 判断是否为 AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * 将未知错误转换为 AppError
 */
export function toAppError(error: unknown, context?: string): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') {
      return AppError.fromCode(ErrorCode.STORAGE_QUOTA_EXCEEDED, context, error);
    }
  }

  if (error instanceof TypeError && error.message.includes('fetch')) {
    return AppError.fromCode(ErrorCode.NETWORK_ERROR, context, error);
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return new AppError(ErrorCode.STORAGE_WRITE_FAILED, message, error instanceof Error ? error : undefined, context);
}

/**
 * 错误处理器
 */
export class ErrorHandler {
  private static instance: ErrorHandler;
  private listeners = new Set<(error: AppError) => void>();

  private constructor() {}

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * 处理错误
   */
  handle(error: unknown, context?: string): AppError {
    const appError = toAppError(error, context);

    // 记录日志
    console.error(`[${appError.code}] ${appError.message}`, appError.context || '', appError.cause || '');

    // 通知监听器
    this.listeners.forEach(listener => listener(appError));

    return appError;
  }

  /**
   * 订阅错误事件
   */
  subscribe(listener: (error: AppError) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const errorHandler = ErrorHandler.getInstance();
