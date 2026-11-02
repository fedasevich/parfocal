import type { ApiError, ErrorKind, FieldError } from "@parfocal/api-client";

export type ErrorAction = "retry" | "sign-in" | "reload";

export type ErrorNotice = {
  kind: ErrorKind;
  tone: "bad" | "warn";
  title: string;
  message: string;
  action: ErrorAction | undefined;
};

type Copy = Omit<ErrorNotice, "kind" | "message"> & { message: string; showsDetail: boolean };

const copyByKind: Record<ErrorKind, Copy> = {
  "bad-request": {
    tone: "bad",
    title: "That request could not be done",
    message: "Check what you entered and try again.",
    action: undefined,
    showsDetail: true,
  },
  unauthenticated: {
    tone: "warn",
    title: "Your session has ended",
    message: "Sign in again to carry on. Nothing you saved is lost.",
    action: "sign-in",
    showsDetail: false,
  },
  forbidden: {
    tone: "bad",
    title: "You do not have access",
    message: "Ask a workspace admin to give you access.",
    action: undefined,
    showsDetail: true,
  },
  "not-found": {
    tone: "bad",
    title: "This was not found",
    message: "It may have been moved or deleted.",
    action: undefined,
    showsDetail: true,
  },
  conflict: {
    tone: "warn",
    title: "Someone changed this first",
    message: "Reload to see the latest version, then try again.",
    action: "reload",
    showsDetail: true,
  },
  validation: {
    tone: "bad",
    title: "Some fields need a fix",
    message: "Check the marked fields and try again.",
    action: undefined,
    showsDetail: false,
  },
  server: {
    tone: "bad",
    title: "Something went wrong on our side",
    message: "Try again in a moment. If it keeps happening, tell your workspace admin.",
    action: "retry",
    showsDetail: false,
  },
  network: {
    tone: "warn",
    title: "You are offline",
    message: "Check your connection. Parfocal retries on its own.",
    action: "retry",
    showsDetail: false,
  },
};

export const errorKinds = Object.keys(copyByKind) as ErrorKind[];

type ErrorLike = Pick<ApiError, "kind" | "problem">;

export function describeApiError(error: ErrorLike): ErrorNotice {
  const { showsDetail, ...copy } = copyByKind[error.kind];
  const detail = showsDetail ? error.problem?.detail?.trim() : undefined;
  return { kind: error.kind, ...copy, message: detail || copy.message };
}

const locationRoots = new Set(["body", "query", "path", "header", "cookie"]);

export function fieldName(location: FieldError["location"]): string {
  const parts = locationRoots.has(String(location[0])) ? location.slice(1) : location;
  return parts.join(".");
}

export function fieldErrorsByName(error: ErrorLike): Record<string, string> {
  const byName: Record<string, string> = {};
  for (const fieldError of error.problem?.errors ?? []) {
    const name = fieldName(fieldError.location);
    byName[name] ??= fieldError.message;
  }
  return byName;
}
