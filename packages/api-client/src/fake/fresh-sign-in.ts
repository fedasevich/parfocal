import { HttpResponse } from "msw";
import { problemMediaType } from "../problem.ts";

const signedInKey = "parfocal.fake-signed-in-at";
export const fakeSignatureWindowMs = 5 * 60_000;

export function markFakeSignIn(at = Date.now()): void {
  globalThis.sessionStorage?.setItem(signedInKey, String(at));
}

export function fakeSignInIsFresh(at = Date.now()): boolean {
  const stamp = Number(globalThis.sessionStorage?.getItem(signedInKey) ?? Number.NaN);
  return Number.isFinite(stamp) && at - stamp <= fakeSignatureWindowMs;
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
