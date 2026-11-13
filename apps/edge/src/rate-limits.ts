import { problem } from "#tiles.ts";

export type LimitEnv = {
  readonly LOGIN_LIMIT?: RateLimit;
  readonly UPLOAD_LIMIT?: RateLimit;
  readonly TILE_LIMIT?: RateLimit;
  readonly ROOM_LIMIT?: RateLimit;
  readonly ROOM_INTERNAL_LIMIT?: RateLimit;
  readonly TRUST_TEST_CLIENT_ADDRESS?: string;
  readonly LOCAL_RUN?: string;
  readonly TURNSTILE_SECRET_KEY?: string;
};

export type LimitClass = "login" | "upload" | "tile" | "room" | "room-internal";

export type Siteverify = (body: FormData) => Promise<Response>;

export const TEST_ADDRESS_HEADER = "X-Parfocal-Test-Client-Address";
export const TURNSTILE_HEADER = "CF-Turnstile-Response";
export const TURNSTILE_QUERY = "turnstile";
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const PERIOD_SECONDS: Readonly<Record<LimitClass, number>> = {
  login: 60,
  upload: 60,
  tile: 10,
  room: 60,
  "room-internal": 60,
};

const LOGIN_PATHS = new Set(["/api/auth/login", "/api/auth/callback"]);
const LOGIN_START = "/api/auth/login";
const UPLOADS_PREFIX = "/api/uploads";
const TILES_PREFIX = "/tiles/";
const ROOMS_PREFIX = "/rt/";
const ROOMS_INTERNAL_PREFIX = "/rt-internal/";
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const siteverify: Siteverify = (body) => fetch(SITEVERIFY_URL, { method: "POST", body });

export const LIMIT_BINDINGS: Readonly<Record<LimitClass, keyof LimitEnv>> = {
  login: "LOGIN_LIMIT",
  upload: "UPLOAD_LIMIT",
  tile: "TILE_LIMIT",
  room: "ROOM_LIMIT",
  "room-internal": "ROOM_INTERNAL_LIMIT",
};

const ASCII_ESCAPE = /%([0-7][0-9a-f])/gi;

export function normalisePath(pathname: string): string {
  const decoded = pathname.replace(ASCII_ESCAPE, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  const trimmed = decoded.replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();
  return trimmed === "" ? "/" : trimmed;
}

function classOf(method: string, normalised: string): LimitClass | null {
  if (LOGIN_PATHS.has(normalised)) return "login";
  const withSlash = `${normalised}/`;
  if (withSlash.startsWith(TILES_PREFIX)) return "tile";
  if (withSlash.startsWith(ROOMS_PREFIX)) return "room";
  if (withSlash.startsWith(ROOMS_INTERNAL_PREFIX)) return "room-internal";
  const upload = withSlash.startsWith(`${UPLOADS_PREFIX}/`);
  if (upload && !READ_METHODS.has(method.toUpperCase())) return "upload";
  return null;
}

export function limitClassOf(method: string, pathname: string): LimitClass | null {
  return classOf(method, normalisePath(pathname));
}

export function clientAddress(request: Request, env: LimitEnv): string {
  const trusted = env.TRUST_TEST_CLIENT_ADDRESS === "true";
  const claimed = trusted ? request.headers.get(TEST_ADDRESS_HEADER) : null;
  return claimed || request.headers.get("CF-Connecting-IP") || "unknown";
}

function binding(env: LimitEnv, kind: LimitClass): RateLimit | undefined {
  return env[LIMIT_BINDINGS[kind]] as RateLimit | undefined;
}

function isLocalRun(env: LimitEnv): boolean {
  return env.LOCAL_RUN === "true";
}

function tooMany(kind: LimitClass): Response {
  const response = problem(429, "rate-limited", "Too many requests from this address");
  response.headers.set("Retry-After", String(PERIOD_SECONDS[kind]));
  return response;
}

async function humanCheck(
  request: Request,
  secret: string,
  address: string,
  verify: Siteverify,
): Promise<boolean> {
  const url = new URL(request.url);
  const token =
    request.headers.get(TURNSTILE_HEADER) ?? url.searchParams.get(TURNSTILE_QUERY) ?? "";
  if (token === "") return false;
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (address !== "unknown") body.set("remoteip", address);
  try {
    const answer = await verify(body);
    if (!answer.ok) return false;
    const outcome = (await answer.json()) as { readonly success?: unknown };
    return outcome.success === true;
  } catch {
    return false;
  }
}

export async function guard(
  request: Request,
  env: LimitEnv,
  verify: Siteverify = siteverify,
): Promise<Response | null> {
  const pathname = normalisePath(new URL(request.url).pathname);
  const kind = classOf(request.method, pathname);
  if (kind === null) return null;
  const address = clientAddress(request, env);
  const limiter = binding(env, kind);
  if (limiter === undefined) {
    if (!isLocalRun(env)) {
      return problem(503, "limit-not-configured", "The request limit is not configured");
    }
  } else {
    const { success } = await limiter.limit({ key: `${kind}:${address}` });
    if (!success) return tooMany(kind);
  }
  const secret = env.TURNSTILE_SECRET_KEY;
  if (pathname === LOGIN_START && secret) {
    if (!(await humanCheck(request, secret, address, verify))) {
      return problem(403, "bot-check-failed", "The sign-in check did not pass");
    }
  }
  return null;
}
