export function toTimestamp(value: Date): number {
  return value.getTime();
}

export function toDateOnly(value: Date | null): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.toISOString().slice(0, 10);
}
