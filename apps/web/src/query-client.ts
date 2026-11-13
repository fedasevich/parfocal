import { ApiError } from "@parfocal/api-client";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isSessionLocked } from "./session/lock-rules.ts";

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

export function toastsMutationError(error: unknown, handledByCaller: boolean): error is ApiError {
  return (
    !handledByCaller &&
    error instanceof ApiError &&
    error.kind !== "validation" &&
    !isSessionLocked(error)
  );
}

export function createQueryClient(
  onMutationError?: (error: ApiError) => void,
  onAnyError?: (error: unknown) => void,
): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (error) => onAnyError?.(error) }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        onAnyError?.(error);
        if (toastsMutationError(error, mutation.options.onError !== undefined)) {
          onMutationError?.(error);
        }
      },
    }),
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
