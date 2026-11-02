import { HttpResponse, http } from "msw";
import { problemMediaType } from "../problem.ts";
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

export function sessionLockHandlers() {
  return [
    http.get("*/api/auth/login", ({ request }) => {
      resetFakeSessionLock();
      return redirectTo(safeReturnPath(new URL(request.url).searchParams.get("return_to")));
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
    http.post("*/api/auth/activity", () => {
      activeAt = Date.now();
      return undefined;
    }),
  ];
}
