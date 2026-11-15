export interface RetryOptions {
  readonly attempts?: number;
  readonly backoffMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);

function describeRange(init: RequestInit | undefined, input: Parameters<typeof fetch>[0]): string {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
  return headers.get("range") ?? "no range";
}

export function retryingFetch(slide: string, options: RetryOptions = {}): typeof globalThis.fetch {
  const attempts = options.attempts ?? 4;
  const backoffMs = options.backoffMs ?? 200;
  const base = options.fetch ?? globalThis.fetch;
  return async (input, init) => {
    let failure = "";
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await base(input, init);
        if (!transientStatuses.has(response.status)) return response;
        failure = `status ${response.status}`;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * 2 ** (attempt - 1)));
      }
    }
    throw new Error(
      `read of ${slide} (${describeRange(init, input)}) failed after ${attempts} attempts: ${failure}`,
    );
  };
}
