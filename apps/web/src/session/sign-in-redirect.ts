import { ApiError, getPasswordSignIn } from "@parfocal/api-client";
import type { FakeApiMode } from "../config.ts";
import { isSessionLocked, locksAt, reauthUrl } from "./lock-rules.ts";

export const redirectPauseMs = 10_000;
const lastRedirectKey = "parfocal.sign-in-redirect-at";

export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "unauthenticated" && !isSessionLocked(error);
}

export function loginUrl(returnTo: string): string {
  return `/api/auth/login?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

export type NamedLogin = {
  returnTo: string;
  loginHint?: string | null | undefined;
  reauth?: boolean;
};

type Send = (url: string, init: RequestInit) => Promise<Response>;

function plainLoginUrl(login: NamedLogin): string {
  return login.reauth ? reauthUrl(login.returnTo) : loginUrl(login.returnTo);
}

function locationOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("location" in body)) return null;
  return typeof body.location === "string" ? body.location : null;
}

export async function startNamedLogin(
  login: NamedLogin,
  go: (url: string) => void = (url) => window.location.assign(url),
  send: Send = (url, init) => fetch(url, init),
): Promise<void> {
  try {
    const response = await send("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        return_to: login.returnTo,
        reauth: login.reauth ?? false,
        login_hint: login.loginHint?.trim() ?? "",
      }),
    });
    const location = response.ok ? locationOf(await response.json()) : null;
    go(location ?? plainLoginUrl(login));
  } catch {
    go(plainLoginUrl(login));
  }
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
