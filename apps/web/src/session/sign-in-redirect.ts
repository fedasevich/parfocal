import { ApiError, getPasswordSignIn } from "@parfocal/api-client";
import type { FakeApiMode } from "../config.ts";
import { isSessionLocked, locksAt } from "./lock-rules.ts";

export const redirectPauseMs = 10_000;
const lastRedirectKey = "parfocal.sign-in-redirect-at";

export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "unauthenticated" && !isSessionLocked(error);
}

export function loginUrl(returnTo: string): string {
  return `/api/auth/login?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

export function signInPageUrl(returnTo: string): string {
  return `/sign-in?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

export function usesHostedSignIn(fakeApi: FakeApiMode): boolean {
  return fakeApi === "off";
}

type Place = { pathname: string; search: string };

type AvailabilityCheck = () => Promise<{ status: number; data: unknown }>;

export async function passwordSignInAvailable(
  fakeApi: FakeApiMode,
  check: AvailabilityCheck = getPasswordSignIn,
): Promise<boolean> {
  if (!usesHostedSignIn(fakeApi)) return true;
  try {
    const answer = await check();
    return (
      answer.status === 200 &&
      typeof answer.data === "object" &&
      answer.data !== null &&
      "available" in answer.data &&
      answer.data.available === true
    );
  } catch {
    return false;
  }
}

export function signedOutTarget(place: Place): string | null {
  if (!locksAt(place.pathname)) return null;
  return signInPageUrl(`${place.pathname}${place.search}`);
}

export function redirectAllowed(lastAt: number | null, at: number): boolean {
  return lastAt === null || at - lastAt >= redirectPauseMs;
}

type Browser = {
  location: Place & { assign(url: string): void };
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
};

export function signedOutRedirect(browser: Browser, now = Date.now) {
  return (error: unknown) => {
    if (!isSignedOut(error)) return;
    const target = signedOutTarget(browser.location);
    if (target === null) return;
    const stored = browser.sessionStorage.getItem(lastRedirectKey);
    const at = now();
    if (!redirectAllowed(stored === null ? null : Number(stored), at)) return;
    browser.sessionStorage.setItem(lastRedirectKey, String(at));
    browser.location.assign(target);
  };
}
