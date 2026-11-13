import { ApiError } from "../problem.ts";

export type DraftMeta = { draft: string };

export const draftMeta = (operationId: string): DraftMeta => ({ draft: operationId });

export function isDraftMeta(meta: Record<string, unknown> | undefined): meta is DraftMeta {
  return typeof meta?.["draft"] === "string";
}

export const notAvailableCode = "not-available-yet";

const missingRouteStatuses: ReadonlySet<number> = new Set([404, 405]);

let draftsAnswered = true;

export function setDraftsAnswered(answered: boolean): void {
  draftsAnswered = answered;
}

export class DraftNotAvailableError extends ApiError {
  readonly operationId: string;

  constructor(operationId: string, status: number) {
    super("not-found", status, {
      type: "about:blank",
      title: "Not available yet",
      status,
      code: notAvailableCode,
      detail: "This part of Parfocal is not built yet.",
    });
    this.name = "DraftNotAvailableError";
    this.operationId = operationId;
  }
}

export function isDraftNotAvailable(error: unknown): error is DraftNotAvailableError {
  return error instanceof DraftNotAvailableError;
}

export async function callDraft<T>(operationId: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!draftsAnswered && error instanceof ApiError && missingRouteStatuses.has(error.status)) {
      throw new DraftNotAvailableError(operationId, error.status);
    }
    throw error;
  }
}

export function withQueryKey<Query extends object, Key>(
  query: Query,
  queryKey: Key,
): Query & { queryKey: Key } {
  const result = { queryKey } as Query & { queryKey: Key };
  for (const key of Object.keys(query)) {
    if (key === "queryKey") continue;
    Object.defineProperty(result, key, {
      enumerable: true,
      configurable: true,
      get: () => (query as Record<string, unknown>)[key],
    });
  }
  return result;
}
