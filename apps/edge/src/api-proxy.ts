import { problem } from "#tiles.ts";

export type ApiEnv = {
  readonly API_ORIGIN?: string;
  readonly MODAL_PROXY_TOKEN_ID?: string;
  readonly MODAL_PROXY_TOKEN_SECRET?: string;
};

export const PROXY_KEY_HEADER = "Modal-Key";
export const PROXY_SECRET_HEADER = "Modal-Secret";

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
  headers.delete(PROXY_KEY_HEADER);
  headers.delete(PROXY_SECRET_HEADER);
  if (env.MODAL_PROXY_TOKEN_ID && env.MODAL_PROXY_TOKEN_SECRET) {
    headers.set(PROXY_KEY_HEADER, env.MODAL_PROXY_TOKEN_ID);
    headers.set(PROXY_SECRET_HEADER, env.MODAL_PROXY_TOKEN_SECRET);
  }
  const init = {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
    duplex: "half",
  } as RequestInit;
  return send(target.toString(), init);
}
