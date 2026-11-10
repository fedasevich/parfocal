export type ByteRange = readonly [start: number, end: number];

export type Capability = {
  readonly tenant: string;
  readonly slide: string;
  readonly original: string;
  readonly size: number;
  readonly restricted: readonly ByteRange[];
  readonly expires: number;
  readonly folder?: string;
};

export type Verdict =
  | { readonly ok: true; readonly capability: Capability }
  | { readonly ok: false; readonly reason: "malformed" | "bad-signature" | "expired" };

const TOKEN_VERSION = 1;
const SHARED_FOLDER = /^samples\/camelyon16\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/$/;
const encoder = new TextEncoder();

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) {
    return null;
  }
  if (text.length % 4 === 1) {
    return null;
  }
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export const MIN_SIGNING_KEY_BYTES = 32;

export class WeakSigningKeyError extends Error {
  constructor() {
    super(`A signing key needs at least ${MIN_SIGNING_KEY_BYTES} bytes in base64`);
    this.name = "WeakSigningKeyError";
  }
}

function keyBytes(secret: string): Uint8Array<ArrayBuffer> {
  let binary = "";
  try {
    binary = atob(secret.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    throw new WeakSigningKeyError();
  }
  if (binary.length < MIN_SIGNING_KEY_BYTES) throw new WeakSigningKeyError();
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function signingKey(secret: string): Promise<CryptoKey> {
  const raw = keyBytes(secret);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function isRange(value: unknown): value is ByteRange {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => Number.isSafeInteger(part) && part >= 0) &&
    value[0] < value[1]
  );
}

function capabilityOf(claims: unknown): Capability | null {
  if (typeof claims !== "object" || claims === null) {
    return null;
  }
  const { v, t, s, o, n, d, e, p } = claims as Record<string, unknown>;
  if (
    v !== TOKEN_VERSION ||
    typeof t !== "string" ||
    typeof s !== "string" ||
    typeof o !== "string" ||
    !Number.isSafeInteger(n) ||
    (n as number) < 0 ||
    !Number.isSafeInteger(e) ||
    !Array.isArray(d) ||
    !d.every(isRange) ||
    (p !== undefined && (typeof p !== "string" || !SHARED_FOLDER.test(p)))
  ) {
    return null;
  }
  return {
    tenant: t,
    slide: s,
    original: o,
    size: n as number,
    restricted: d,
    expires: e as number,
    ...(p === undefined ? {} : { folder: p }),
  };
}

export async function verifyCapability(
  token: string,
  key: CryptoKey,
  nowSeconds: number,
): Promise<Verdict> {
  const parts = token.split(".");
  if (parts.length !== 2 || parts.some((part) => part === "")) {
    return { ok: false, reason: "malformed" };
  }
  const [payload = "", signature = ""] = parts;
  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(payload);
  if (signatureBytes === null || payloadBytes === null) {
    return { ok: false, reason: "malformed" };
  }
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(payload));
  if (!valid) {
    return { ok: false, reason: "bad-signature" };
  }
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const capability = capabilityOf(claims);
  if (capability === null) {
    return { ok: false, reason: "malformed" };
  }
  if (capability.expires <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, capability };
}

export async function signCapability(capability: Capability, key: CryptoKey): Promise<string> {
  const claims = {
    d: capability.restricted,
    e: capability.expires,
    n: capability.size,
    o: capability.original,
    ...(capability.folder === undefined ? {} : { p: capability.folder }),
    s: capability.slide,
    t: capability.tenant,
    v: TOKEN_VERSION,
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export function overlapsRestricted(
  restricted: readonly ByteRange[],
  start: number,
  endExclusive: number,
): boolean {
  return restricted.some(([from, to]) => start < to && from < endExclusive);
}
