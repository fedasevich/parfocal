import { HttpResponse } from "msw";
import { problemMediaType } from "../problem.ts";

const signedInKey = "parfocal.fake-signed-in-at";
export const fakeSignatureWindowMs = 5 * 60_000;

let signedInHere: number | null = null;

export function markFakeSignIn(at = Date.now()): void {
  signedInHere = at;
  globalThis.sessionStorage?.setItem(signedInKey, String(at));
}

export function forgetFakeSignIn(): void {
  signedInHere = null;
  globalThis.sessionStorage?.removeItem(signedInKey);
}

export function fakeSignInIsFresh(at = Date.now()): boolean {
  const stored = globalThis.sessionStorage?.getItem(signedInKey);
  const stamp = stored == null ? signedInHere : Number(stored);
  return stamp !== null && Number.isFinite(stamp) && at - stamp <= fakeSignatureWindowMs;
}

export function freshSignInRefusal(): HttpResponse<Record<string, unknown>> | null {
  if (fakeSignInIsFresh()) return null;
  return HttpResponse.json(
    {
      type: "about:blank",
      title: "Sign in again to sign. A signature needs a sign-in from the last 5 minutes",
      status: 403,
      code: "fresh-sign-in-needed",
    },
    { status: 403, headers: { "content-type": problemMediaType } },
  );
}
