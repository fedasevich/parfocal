import { fromBase64Url, signingKey, toBase64Url } from "#capability.ts";

export type RoomGrant = {
  readonly tenant: string;
  readonly room: string;
  readonly user: string;
  readonly project: string | null;
  readonly expires: number;
};

export type RoomTokenCheck =
  | { readonly ok: true; readonly grant: RoomGrant }
  | { readonly ok: false; readonly reason: "malformed" | "signature" | "expired" };

const ROOM_TOKEN_VERSION = 1;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROOM_NAME = new RegExp(`^(slide|task|user|project):${UUID}$`);
const ID = new RegExp(`^${UUID}$`);
const encoder = new TextEncoder();

export function isRoomName(text: string): boolean {
  return ROOM_NAME.test(text);
}

const keys = new Map<string, Promise<CryptoKey>>();

export function roomKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (key === undefined) {
    key = signingKey(secret);
    keys.set(secret, key);
  }
  return key;
}

function grantOf(claims: unknown): RoomGrant | null {
  if (typeof claims !== "object" || claims === null) {
    return null;
  }
  const { v, t, r, u, p, e } = claims as Record<string, unknown>;
  if (
    v !== ROOM_TOKEN_VERSION ||
    typeof t !== "string" ||
    !ID.test(t) ||
    typeof r !== "string" ||
    !isRoomName(r) ||
    typeof u !== "string" ||
    !ID.test(u) ||
    !(p === null || (typeof p === "string" && ID.test(p))) ||
    !Number.isSafeInteger(e)
  ) {
    return null;
  }
  return { tenant: t, room: r, user: u, project: p, expires: e as number };
}

export async function verifyRoomToken(
  token: string,
  key: CryptoKey,
  nowSeconds: number,
): Promise<RoomTokenCheck> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "malformed" };
  }
  const [payload = "", signature = ""] = parts;
  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(payload);
  if (signatureBytes === null || payloadBytes === null) {
    return { ok: false, reason: "malformed" };
  }
  if (!(await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(payload)))) {
    return { ok: false, reason: "signature" };
  }
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const grant = grantOf(claims);
  if (grant === null) {
    return { ok: false, reason: "malformed" };
  }
  if (grant.expires <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, grant };
}

export async function signRoomToken(grant: RoomGrant, key: CryptoKey): Promise<string> {
  const claims = {
    e: grant.expires,
    p: grant.project,
    r: grant.room,
    t: grant.tenant,
    u: grant.user,
    v: ROOM_TOKEN_VERSION,
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function publishSignature(key: CryptoKey, stamp: number, body: string): Promise<string> {
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`publish.${stamp}.${body}`));
  return toBase64Url(new Uint8Array(signed));
}

export const PUBLISH_WINDOW_SECONDS = 60;

export async function signPublish(key: CryptoKey, stamp: number, body: string): Promise<string> {
  return `${stamp}.${await publishSignature(key, stamp, body)}`;
}

const PUBLISH_SIGNATURE = /^(\d{1,12})\.([A-Za-z0-9_-]+)$/;

export function isPublishSignature(header: string | null): header is string {
  return header !== null && PUBLISH_SIGNATURE.test(header);
}

export async function verifyPublish(
  key: CryptoKey,
  header: string | null,
  body: string,
  nowSeconds: number,
): Promise<boolean> {
  const match = PUBLISH_SIGNATURE.exec(header ?? "");
  if (match === null) {
    return false;
  }
  const stamp = Number(match[1]);
  if (Math.abs(nowSeconds - stamp) > PUBLISH_WINDOW_SECONDS) {
    return false;
  }
  const given = fromBase64Url(match[2] ?? "");
  if (given === null) {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, given, encoder.encode(`publish.${stamp}.${body}`));
}
