import {
  ApiError,
  getGetMeQueryKey,
  getGetMyAvailabilityQueryKey,
  getGetMyHomeQueryKey,
  getGetPlatformStatusQueryKey,
  getGetSessionPolicyQueryKey,
  getListMyAdjudicationsQueryKey,
  getListMyReviewTasksQueryKey,
  getListProjectsQueryKey,
  getListTenantMembersQueryKey,
  isDraftNotAvailable,
} from "@parfocal/api-client";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isSessionLocked, needsSecondFactor } from "./session/lock-rules.ts";
import { isMaintenanceError } from "./shell/maintenance-notice.ts";

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
  if (isDraftNotAvailable(error)) return true;
  return (
    !handledByCaller &&
    error instanceof ApiError &&
    error.kind !== "validation" &&
    !isSessionLocked(error) &&
    !needsSecondFactor(error)
  );
}

export function createQueryClient(
  onMutationError?: (error: ApiError) => void,
  onAnyError?: (error: unknown, queryKey?: readonly unknown[]) => void,
): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => onAnyError?.(error, query.queryKey) }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        onAnyError?.(error);
        if (isMaintenanceError(error)) {
          void client.invalidateQueries({ queryKey: getGetPlatformStatusQueryKey() });
        }
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
  for (const queryKey of shellQueryKeys()) {
    client.setQueryDefaults(queryKey, { staleTime: shellStaleMs });
  }
  client.setQueryDefaults(getGetMeQueryKey(), { staleTime: shellStaleMs, retryOnMount: false });
  return client;
}

const shellStaleMs = 5 * 60_000;

function shellQueryKeys() {
  return [
    getGetMeQueryKey(),
    getListProjectsQueryKey(),
    getGetMyHomeQueryKey(),
    getListMyReviewTasksQueryKey(),
    getListMyAdjudicationsQueryKey(),
    getListTenantMembersQueryKey(),
    getGetSessionPolicyQueryKey(),
    getGetMyAvailabilityQueryKey(),
  ];
}
