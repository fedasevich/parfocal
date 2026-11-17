import assert from "node:assert/strict";
import { test } from "node:test";
import {
  creationOptions,
  credentialJson,
  deviceName,
  fromBase64Url,
  PasskeyCancelledError,
  rememberedPasskeyEmail,
  rememberPasskeyEmail,
  requestOptions,
  toBase64Url,
} from "../src/session/passkeys.ts";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

test("base64url round trips bytes without padding or plus and slash", () => {
  const raw = bytes(251, 255, 191, 0, 1);
  const text = toBase64Url(raw);
  assert.equal(text, "-_-_AAE");
  assert.deepEqual(new Uint8Array(fromBase64Url(text)), new Uint8Array(raw));
});

test("creation options decode the challenge and user id and ask for a discoverable passkey", () => {
  const options = creationOptions({
    challenge: "AAEC",
    rp: { id: "app.parfocal.eu", name: "ZITADEL" },
    user: { id: "Mzk0", name: "a@lab.test", displayName: "A" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [{ id: "AQ", type: "public-key" }],
    authenticatorSelection: { userVerification: "required" },
  });
  assert.deepEqual(new Uint8Array(options.challenge as ArrayBuffer), new Uint8Array([0, 1, 2]));
  assert.equal(new TextDecoder().decode(options.user.id as ArrayBuffer), "394");
  assert.deepEqual(options.rp, { id: "app.parfocal.eu", name: "Parfocal" });
  assert.equal(options.authenticatorSelection?.residentKey, "required");
  assert.equal(options.authenticatorSelection?.userVerification, "required");
  assert.deepEqual(
    new Uint8Array(options.excludeCredentials?.[0]?.id as ArrayBuffer),
    new Uint8Array([1]),
  );
});

test("request options decode the challenge and the allowed credentials", () => {
  const options = requestOptions({
    challenge: "AAEC",
    rpId: "app.parfocal.eu",
    allowCredentials: [{ id: "AQI", type: "public-key" }],
  });
  assert.equal(options.rpId, "app.parfocal.eu");
  assert.deepEqual(
    new Uint8Array(options.allowCredentials?.[0]?.id as ArrayBuffer),
    new Uint8Array([1, 2]),
  );
});

test("a credential becomes JSON with base64url fields", () => {
  const credential = {
    id: "AQI",
    rawId: bytes(1, 2),
    type: "public-key",
    response: {
      clientDataJSON: bytes(123, 125),
      authenticatorData: bytes(9),
      signature: bytes(8),
      userHandle: bytes(51, 57),
    },
  } as unknown as Credential;
  assert.deepEqual(credentialJson(credential), {
    id: "AQI",
    rawId: "AQI",
    type: "public-key",
    response: {
      clientDataJSON: "e30",
      authenticatorData: "CQ",
      signature: "CA",
      userHandle: "Mzk",
    },
  });
});

test("no credential means the person closed the passkey window", () => {
  assert.throws(() => credentialJson(null), PasskeyCancelledError);
});

test("the passkey is named after the device", () => {
  assert.equal(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari"), "Mac");
  assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iPhone");
  assert.equal(deviceName("curl/8"), "Passkey");
});

test("the email of the last passkey sign-in is remembered for autofill", () => {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  };
  assert.equal(rememberedPasskeyEmail(storage), null);
  rememberPasskeyEmail(" anna@lab.test ", storage);
  assert.equal(rememberedPasskeyEmail(storage), "anna@lab.test");
});
