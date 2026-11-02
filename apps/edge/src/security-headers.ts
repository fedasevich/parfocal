export const NONCE_PLACEHOLDER = "PARFOCAL_CSP_NONCE";

export const PERMISSIONS_POLICY = [
  "hid=(self)",
  "gamepad=(self)",
  "fullscreen=(self)",
  "cross-origin-isolated=(self)",
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "midi=()",
  "display-capture=()",
  "browsing-topics=()",
].join(", ");

export const STATIC_HEADERS: Readonly<Record<string, string>> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": PERMISSIONS_POLICY,
};

const HSTS = "max-age=31536000; includeSubDomains";

export type CspOptions = {
  readonly nonce: string;
  readonly uploadOrigin?: string | undefined;
};

export function uploadOriginOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("UPLOAD_ORIGIN must be an https origin");
  return url.origin;
}

export function contentSecurityPolicy({ nonce, uploadOrigin }: CspOptions): string {
  const connect = ["'self'", ...(uploadOrigin ? [uploadOrigin] : [])];
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    `connect-src ${connect.join(" ")}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function isHtml(response: Response): boolean {
  return (response.headers.get("Content-Type") ?? "").toLowerCase().startsWith("text/html");
}

function secured(response: Response, body: BodyInit | null, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(STATIC_HEADERS)) headers.set(name, value);
  if (!headers.has("Cross-Origin-Resource-Policy")) {
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  if (new URL(request.url).protocol === "https:") headers.set("Strict-Transport-Security", HSTS);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export async function withSecurityHeaders(
  request: Request,
  response: Response,
  options: { readonly uploadOrigin?: string | undefined; readonly nonce?: () => string } = {},
): Promise<Response> {
  if (response.status === 101) return response;
  if (!isHtml(response)) return secured(response, response.body, request);
  const nonce = (options.nonce ?? newNonce)();
  const html = (await response.text()).replaceAll(NONCE_PLACEHOLDER, nonce);
  const document = secured(response, html, request);
  document.headers.delete("Content-Length");
  document.headers.delete("ETag");
  document.headers.set("Cache-Control", "no-store");
  document.headers.set(
    "Content-Security-Policy",
    contentSecurityPolicy({ nonce, uploadOrigin: uploadOriginOf(options.uploadOrigin) }),
  );
  return document;
}

const REQUIRED_EVERYWHERE = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "credentialless",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
} as const;

export function headerProblems(headers: Headers, kind: "document" | "resource"): string[] {
  const problems: string[] = [];
  for (const [name, expected] of Object.entries(REQUIRED_EVERYWHERE)) {
    const actual = headers.get(name);
    if (actual !== expected)
      problems.push(`${name} is ${actual ?? "missing"}, expected ${expected}`);
  }
  const permissions = headers.get("permissions-policy") ?? "";
  for (const feature of ["hid=(self)", "gamepad=(self)", "camera=()"]) {
    if (!permissions.includes(feature)) problems.push(`permissions-policy lacks ${feature}`);
  }
  if (kind === "resource") return problems;
  const csp = headers.get("content-security-policy") ?? "";
  for (const directive of [
    /script-src 'nonce-[A-Za-z0-9+/=]{16,}' 'strict-dynamic' 'wasm-unsafe-eval'/,
    /worker-src 'self' blob:/,
    /object-src 'none'/,
    /base-uri 'none'/,
    /frame-ancestors 'none'/,
  ]) {
    if (!directive.test(csp)) problems.push(`content-security-policy lacks ${directive.source}`);
  }
  if (/(^|\s)'unsafe-eval'/.test(csp)) {
    problems.push("content-security-policy allows unsafe-eval");
  }
  if (headers.get("cache-control") !== "no-store") problems.push("document is cacheable");
  return problems;
}

export function nonceOf(headers: Headers): string | null {
  return /'nonce-([^']+)'/.exec(headers.get("content-security-policy") ?? "")?.[1] ?? null;
}
