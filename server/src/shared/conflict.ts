export function createVersionConflictError(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'VERSION_CONFLICT',
  });
}

export function ensureMutationResult<T>(
  existing: T | null,
  result: T | null,
  message: string
) {
  if (!existing) {
    return null;
  }

  if (!result) {
    throw createVersionConflictError(message);
  }

  return result;
}
