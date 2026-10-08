export type FieldError = {
  location: (string | number)[];
  message: string;
  code: string;
};

export type Problem = {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: FieldError[];
};

export type ErrorKind =
  | "bad-request"
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "validation"
  | "server"
  | "network";

const kindsByStatus: Record<number, ErrorKind> = {
  400: "bad-request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not-found",
  409: "conflict",
  422: "validation",
};

export const problemMediaType = "application/problem+json";

export class ApiError extends Error {
  readonly kind: ErrorKind;
  readonly status: number;
  readonly problem: Problem | undefined;

  constructor(kind: ErrorKind, status: number, problem?: Problem) {
    super(problem?.title ?? `Request failed with ${kind}`);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.problem = problem;
  }

  fieldErrors(): FieldError[] {
    return this.problem?.errors ?? [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldError(value: unknown): value is FieldError {
  return (
    isRecord(value) &&
    Array.isArray(value.location) &&
    value.location.every((part) => typeof part === "string" || typeof part === "number") &&
    typeof value.message === "string" &&
    typeof value.code === "string"
  );
}

export function isProblem(value: unknown): value is Problem {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "number" &&
    typeof value.code === "string" &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.errors === undefined ||
      (Array.isArray(value.errors) && value.errors.every(isFieldError)))
  );
}

export function kindForStatus(status: number): ErrorKind {
  return kindsByStatus[status] ?? (status >= 500 ? "server" : "bad-request");
}

async function readProblem(response: Response): Promise<Problem | undefined> {
  if (!response.headers.get("content-type")?.startsWith(problemMediaType)) return undefined;
  try {
    const body: unknown = await response.json();
    return isProblem(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

export async function toApiError(response: Response): Promise<ApiError> {
  return new ApiError(kindForStatus(response.status), response.status, await readProblem(response));
}

export function networkError(): ApiError {
  return new ApiError("network", 0);
}
