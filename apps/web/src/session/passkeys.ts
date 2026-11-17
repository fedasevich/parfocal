import {
  finishPasskeySignIn,
  type SignInLanding,
  savePasskey,
  startPasskeyRegistration,
  startPasskeySignIn,
} from "@parfocal/api-client";

type Json = Record<string, unknown>;

export type PasskeyBrowser = {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
};

export class PasskeyCancelledError extends Error {}

export function toBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): ArrayBuffer {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

const record = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const withIds = (list: unknown): PublicKeyCredentialDescriptor[] =>
  (Array.isArray(list) ? list : []).map((item) => {
    const entry = record(item);
    return { ...entry, type: "public-key", id: fromBase64Url(text(entry.id)) };
  });

export function creationOptions(json: Json): PublicKeyCredentialCreationOptions {
  const user = record(json.user);
  return {
    ...(json as unknown as PublicKeyCredentialCreationOptions),
    challenge: fromBase64Url(text(json.challenge)),
    rp: { ...record(json.rp), name: "Parfocal" },
    user: {
      id: fromBase64Url(text(user.id)),
      name: text(user.name),
      displayName: text(user.displayName),
    },
    excludeCredentials: withIds(json.excludeCredentials),
    authenticatorSelection: {
      ...record(json.authenticatorSelection),
      residentKey: "required",
      requireResidentKey: true,
    },
  };
}

export function requestOptions(json: Json): PublicKeyCredentialRequestOptions {
  return {
    ...(json as unknown as PublicKeyCredentialRequestOptions),
    challenge: fromBase64Url(text(json.challenge)),
    allowCredentials: withIds(json.allowCredentials),
  };
}

type CreatedResponse = { clientDataJSON: ArrayBuffer; attestationObject?: ArrayBuffer };
type AssertedResponse = {
  clientDataJSON: ArrayBuffer;
  authenticatorData?: ArrayBuffer;
  signature?: ArrayBuffer;
  userHandle?: ArrayBuffer | null;
};

export function credentialJson(credential: Credential | null): Json {
  if (credential === null) throw new PasskeyCancelledError();
  const key = credential as PublicKeyCredential;
  const response = key.response as unknown as CreatedResponse & AssertedResponse;
  const encoded: Json = { clientDataJSON: toBase64Url(response.clientDataJSON) };
  if (response.attestationObject) {
    encoded.attestationObject = toBase64Url(response.attestationObject);
  }
  if (response.authenticatorData) {
    encoded.authenticatorData = toBase64Url(response.authenticatorData);
  }
  if (response.signature) encoded.signature = toBase64Url(response.signature);
  if (response.userHandle) encoded.userHandle = toBase64Url(response.userHandle);
  return { id: key.id, rawId: toBase64Url(key.rawId), type: key.type, response: encoded };
}

function cancelled(error: unknown): never {
  if (error instanceof DOMException && ["NotAllowedError", "AbortError"].includes(error.name)) {
    throw new PasskeyCancelledError();
  }
  throw error;
}

const browserCredentials = (): PasskeyBrowser => navigator.credentials;

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

export function deviceName(userAgent: string = navigator.userAgent): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Mac OS X/.test(userAgent)) return "Mac";
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows/.test(userAgent)) return "Windows";
  return "Passkey";
}

export async function addPasskey(browser: PasskeyBrowser = browserCredentials()): Promise<void> {
  const started = await startPasskeyRegistration();
  if (started.status !== 200) throw new Error("passkey registration did not start");
  const publicKey = creationOptions(started.data.options);
  const credential = await browser.create({ publicKey }).catch(cancelled);
  await savePasskey({
    passkey: started.data.passkey,
    name: deviceName(),
    credential: credentialJson(credential),
  });
}

export type PasskeySignIn = {
  email: string;
  returnTo: string;
  conditional?: AbortSignal;
};

export async function signInWithPasskey(
  attempt: PasskeySignIn,
  browser: PasskeyBrowser = browserCredentials(),
): Promise<SignInLanding> {
  const started = await startPasskeySignIn({ email: attempt.email.trim() });
  if (started.status !== 200) throw new Error("passkey sign-in did not start");
  const publicKey = requestOptions(started.data.options);
  const request: CredentialRequestOptions =
    attempt.conditional === undefined
      ? { publicKey }
      : { publicKey, mediation: "conditional", signal: attempt.conditional };
  const credential = await browser.get(request).catch(cancelled);
  const landed = await finishPasskeySignIn({
    credential: credentialJson(credential),
    return_to: attempt.returnTo,
  });
  if (landed.status !== 200) throw new Error("passkey sign-in did not finish");
  return landed.data;
}

export async function platformPasskeyAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
}

export async function autofillAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const check = (
    PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> }
  ).isConditionalMediationAvailable;
  return check === undefined ? false : check.call(PublicKeyCredential).catch(() => false);
}

const lastEmailKey = "parfocal.passkey-email";
export const passkeyOfferDeclinedKey = "parfocal.passkey-offer-declined";

export function declinePasskeyOffer(storage: Pick<Storage, "setItem"> = localStorage) {
  storage.setItem(passkeyOfferDeclinedKey, "yes");
}

export function passkeyOfferDeclined(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return storage.getItem(passkeyOfferDeclinedKey) !== null;
}

export function rememberPasskeyEmail(
  email: string,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  storage.setItem(lastEmailKey, email.trim());
}

export function rememberedPasskeyEmail(
  storage: Pick<Storage, "getItem"> = localStorage,
): string | null {
  const stored = storage.getItem(lastEmailKey);
  return stored === null || stored === "" ? null : stored;
}
