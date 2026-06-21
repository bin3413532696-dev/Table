export type ApiErrorPayload = {
  error?: string;
  message?: string;
  details?: unknown;
  detail?: unknown;
};

import { isRecord, readObjectField, readStringField } from './guards';

export function getMessageFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const message = readStringField(payload, 'message');
  if (message && message.trim()) {
    return message;
  }

  const error = readStringField(payload, 'error');
  if (error && error.trim()) {
    return error;
  }

  const detail = readStringField(payload, 'detail');
  if (detail && detail.trim()) {
    return detail;
  }

  const nestedDetail = readObjectField(payload, 'detail');
  if (nestedDetail) {
    return getMessageFromPayload(nestedDetail);
  }

  return null;
}

export function normalizeApiErrorPayload(payload: unknown): ApiErrorPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  return {
    error: readStringField(payload, 'error') ?? undefined,
    message: readStringField(payload, 'message') ?? undefined,
    details: payload.details,
    detail: payload.detail,
  };
}

export async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  let payload: ApiErrorPayload | unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return getMessageFromPayload(payload) || fallback;
}
