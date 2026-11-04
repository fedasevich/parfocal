import { ApiError } from "@parfocal/api-client";

export const activityIntervalMs = 60_000;
export const defaultIdleLockMinutes = 15;

export function isSessionLocked(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.kind === "unauthenticated" &&
    error.problem?.code === "session-locked"
  );
}

export function createActivityThrottle(intervalMs = activityIntervalMs) {
  let lastSent: number | null = null;
  return {
    shouldSend(at: number): boolean {
      if (lastSent !== null && at - lastSent < intervalMs) return false;
      lastSent = at;
      return true;
    },
  };
}

export function idleCheckDue(lastInput: number, at: number, idleMinutes: number): boolean {
  return at - lastInput >= idleMinutes * 60_000;
}

export function reauthUrl(returnTo: string): string {
  const query = new URLSearchParams({ reauth: "true", return_to: returnTo });
  return `/api/auth/login?${query.toString()}`;
}

const publicPaths = ["/sign-in", "/sign-up", "/invite", "/shared-reports"];

export function locksAt(pathname: string): boolean {
  return !publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
