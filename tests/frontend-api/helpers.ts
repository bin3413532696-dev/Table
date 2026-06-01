export type FetchCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

export function installFetchMock(
  responder: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return responder(input, init);
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

export function getHeader(headers: HeadersInit | undefined, key: string): string | null {
  if (!headers) {
    return null;
  }

  const normalized = new Headers(headers);
  return normalized.get(key);
}
