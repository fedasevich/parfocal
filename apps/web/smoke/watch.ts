import type { BrowserContext, Page } from "@playwright/test";

export type ProblemKind = "console" | "page-error" | "api" | "write" | "error-screen";

export type Problem = { kind: ProblemKind; where: string; detail: string };

export const errorScreens = [
  "issue-server-error",
  "issue-not-found",
  "issue-session-expired",
  "issue-no-access",
] as const;

const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const allowedWritePrefix = "/api/auth/";

export function sameOrigin(address: string, origin: string): boolean {
  try {
    return new URL(address).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function isApiCall(address: string, origin: string): boolean {
  if (!sameOrigin(address, origin)) return false;
  const path = new URL(address).pathname;
  return path === "/api" || path.startsWith("/api/");
}

export function blocksWrite(method: string, address: string, origin: string): boolean {
  if (readMethods.has(method.toUpperCase())) return false;
  if (!isApiCall(address, origin)) return false;
  return !new URL(address).pathname.startsWith(allowedWritePrefix);
}

export function apiFailed(status: number, signedOut: boolean): boolean {
  if (signedOut && status === 401) return false;
  return status >= 400;
}

export function countsAsConsoleError(text: string): boolean {
  return !text.startsWith("Failed to load resource");
}

export function pathOf(address: string): string {
  try {
    const url = new URL(address);
    return url.pathname;
  } catch {
    return address;
  }
}

export function report(problems: readonly Problem[]): string {
  if (problems.length === 0) return "no problems";
  return problems
    .map((problem) => `${problem.kind} on ${problem.where}: ${problem.detail}`)
    .join("\n");
}

const NAVIGATION_ABORT = "net::ERR_ABORTED";

export type Watch = {
  problems: Problem[];
  step: (name: string) => void;
  signedIn: () => void;
};

export async function watch(context: BrowserContext, origin: string): Promise<Watch> {
  const problems: Problem[] = [];
  let where = "start";
  let signedOut = true;
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (blocksWrite(request.method(), request.url(), origin)) {
      problems.push({
        kind: "write",
        where,
        detail: `${request.method()} ${pathOf(request.url())} was blocked`,
      });
      await route.abort("blockedbyclient");
      return;
    }
    await route.fallback();
  });
  const follow = (page: Page) => {
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (!sameOrigin(page.url(), origin)) return;
      if (!countsAsConsoleError(message.text())) return;
      problems.push({ kind: "console", where, detail: message.text().slice(0, 300) });
    });
    page.on("pageerror", (error) => {
      if (!sameOrigin(page.url(), origin)) return;
      problems.push({ kind: "page-error", where, detail: error.message.slice(0, 300) });
    });
    page.on("response", (response) => {
      if (!isApiCall(response.url(), origin)) return;
      if (!apiFailed(response.status(), signedOut)) return;
      problems.push({
        kind: "api",
        where,
        detail: `${response.request().method()} ${pathOf(response.url())} answered ${response.status()}`,
      });
    });
    page.on("requestfailed", (request) => {
      if (!isApiCall(request.url(), origin)) return;
      if (blocksWrite(request.method(), request.url(), origin)) return;
      if (request.failure()?.errorText === NAVIGATION_ABORT) return;
      problems.push({
        kind: "api",
        where,
        detail: `${request.method()} ${pathOf(request.url())} failed: ${request.failure()?.errorText ?? "unknown"}`,
      });
    });
  };
  for (const page of context.pages()) follow(page);
  context.on("page", follow);
  return {
    problems,
    step: (name) => {
      where = name;
    },
    signedIn: () => {
      signedOut = false;
    },
  };
}

export async function errorScreenShown(page: Page): Promise<string | null> {
  for (const id of errorScreens) {
    if (await page.getByTestId(id).isVisible()) return id;
  }
  return null;
}
