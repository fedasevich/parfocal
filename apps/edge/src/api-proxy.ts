import { problem } from "#tiles.ts";

export type ApiEnv = {
  readonly API_ORIGIN?: string;
};

export type Send = (input: string, init: RequestInit) => Promise<Response>;

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function handleApi(
  request: Request,
  env: ApiEnv,
  send: Send = (input, init) => fetch(input, init),
): Promise<Response> | Response {
  if (!env.API_ORIGIN) {
    return problem(503, "api-not-configured", "The API is not configured");
  }
  const from = new URL(request.url);
  const target = new URL(`${from.pathname}${from.search}`, env.API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.set("X-Forwarded-Host", from.host);
  const init = {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
    duplex: "half",
  } as RequestInit;
  return send(target.toString(), init);
}
