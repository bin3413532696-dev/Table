import { AppError, ErrorCode, errorHandler } from '../../core/errors';
import { getMessageFromPayload } from './error';
import { fetchWithAuth } from '../auth';

export type ApiListResponse<T> = {
  items: T[];
  total: number;
  source: string;
};

export type ApiDataResponse<T> = {
  data: T;
  source: string;
};

async function parseApiError(response: Response, context: string): Promise<AppError> {
  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const message = getMessageFromPayload(payload) || context;

  if (response.status === 400 || response.status === 422) {
    return AppError.fromCode(ErrorCode.VALIDATION_FAILED, message);
  }

  if (response.status === 404) {
    return AppError.fromCode(ErrorCode.ENTITY_NOT_FOUND, message);
  }

  if (response.status === 409) {
    return AppError.fromCode(ErrorCode.VERSION_CONFLICT, message);
  }

  if (response.status === 401 || response.status === 403) {
    return new AppError(ErrorCode.NETWORK_ERROR, message);
  }

  return AppError.fromCode(ErrorCode.NETWORK_ERROR, `${message} (HTTP ${response.status})`);
}

export function getErrorMessage(error: unknown, fallback = '未知错误'): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    const headers = new Headers(init?.headers);
    const hasBody = init?.body !== undefined && init?.body !== null;
    const isFormDataBody = typeof FormData !== 'undefined' && init?.body instanceof FormData;

    if (hasBody && !isFormDataBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    response = await fetchWithAuth(path, {
      ...init,
      headers,
    });
  } catch (error) {
    throw errorHandler.handle(error, path);
  }

  if (!response.ok) {
    throw errorHandler.handle(await parseApiError(response, path), path);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

export async function requestApiData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requestApi<ApiDataResponse<T>>(path, init);
  return response.data;
}
