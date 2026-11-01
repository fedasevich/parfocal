import { ApiError } from "@parfocal/api-client";
import { QueryClient } from "@tanstack/react-query";

const maxRetries = 3;
const firstRetryDelayMs = 250;
const maxRetryDelayMs = 4000;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= maxRetries) return false;
  return error instanceof ApiError && (error.kind === "network" || error.kind === "server");
}

export function retryDelay(attempt: number): number {
  return Math.min(firstRetryDelayMs * 2 ** attempt, maxRetryDelayMs);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
        retryDelay,
      },
    },
  });
}
