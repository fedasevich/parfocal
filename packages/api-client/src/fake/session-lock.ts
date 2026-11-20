import { HttpResponse, http } from "msw";
import { problemMediaType } from "../problem.ts";
import { markFakeSignIn } from "./fresh-sign-in.ts";
import { sessionPolicy } from "./scenario-admin.ts";

let activeAt = Date.now();
let locked = false;

function resetFakeSessionLock(at = Date.now()): void {
  activeAt = at;
  locked = false;
}

function fakeSessionLocked(at = Date.now()): boolean {
  if (at - activeAt >= sessionPolicy.idleLockMinutes * 60_000) locked = true;
  return locked;
}

const lockedProblem = {
  type: "about:blank",
  title: "Your session is locked. Sign in again to continue",
  status: 401,
  code: "session-locked",
};

function safeReturnPath(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

const redirectTo = (location: string) =>
  new HttpResponse(null, { status: 302, headers: { location } });

const fakeSessionKey = "parfocal.fake-session";

type FakeSession = "signed-out" | "expired" | "ended";

function fakeSession(): FakeSession | null {
  const value = globalThis.sessionStorage?.getItem(fakeSessionKey);
  return value === "signed-out" || value === "expired" || value === "ended" ? value : null;
}

const endedProblem = {
  type: "about:blank",
  title: "Your session ended. Sign in again to continue",
  status: 401,
  code: "session-expired",
  current: { session_hours: sessionPolicy.sessionHours },
};

const problemFor = (session: FakeSession) =>
  session === "expired" ? lockedProblem : session === "ended" ? endedProblem : signedOutProblem;

const signedOutProblem = {
  type: "about:blank",
  title: "Sign in to continue",
  status: 401,
};

function answersSignedOut(pathname: string): boolean {
  return !pathname.startsWith("/api/auth/") && pathname !== "/api/status";
}

export function sessionLockHandlers() {
  return [
    http.all("*/api/*", ({ request }) => {
      const session = fakeSession();
      if (session === null || !answersSignedOut(new URL(request.url).pathname)) return undefined;
      return HttpResponse.json(problemFor(session), {
        status: 401,
        headers: { "content-type": problemMediaType },
      });
    }),
    http.get("*/api/auth/login", ({ request }) => {
      resetFakeSessionLock();
      const query = new URL(request.url).searchParams;
      if (query.get("reauth") === "true") markFakeSignIn();
      return redirectTo(safeReturnPath(query.get("return_to")));
    }),
    http.post("*/api/auth/login", async ({ request }) => {
      resetFakeSessionLock();
      const body: unknown = await request.json().catch(() => null);
      if (typeof body === "object" && body !== null && "reauth" in body && body.reauth === true) {
        markFakeSignIn();
      }
      const returnTo =
        typeof body === "object" && body !== null && "return_to" in body
          ? String(body.return_to)
          : null;
      return HttpResponse.json({ location: safeReturnPath(returnTo) });
    }),
    http.get("*/api/auth/logout", () => {
      resetFakeSessionLock();
      return redirectTo("/sign-in");
    }),
    http.all("*/api/*", () => {
      if (!fakeSessionLocked()) return undefined;
      return HttpResponse.json(lockedProblem, {
        status: 401,
        headers: { "content-type": problemMediaType },
      });
    }),
    http.post("*/api/auth/lock", () => {
      locked = true;
      return new HttpResponse(null, { status: 204 });
    }),
    http.post("*/api/auth/activity", () => {
      activeAt = Date.now();
      return undefined;
    }),
  ];
}
