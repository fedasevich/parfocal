import { HttpResponse, http, type RequestHandler } from "msw";
import { z } from "zod";
import type { PasskeyCreation, SavedPasskeySummary, SignInLanding } from "../generated/api.ts";
import { defaultReturnPath, isSafeReturnPath } from "./admin-handlers.ts";
import { markFakeSignIn } from "./fresh-sign-in.ts";
import { people } from "./scenario.ts";
import { signInSecrets } from "./scenario-admin.ts";

type FieldIssue = { location: string[]; message: string; code: string };

const problem = (status: number, title: string, code: string, errors?: FieldIssue[]) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code, ...(errors === undefined ? {} : { errors }) },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const unreadable = () => problem(422, "That request is not complete", "invalid-request");

export const landing = (returnTo: string | null): SignInLanding => ({
  return_to: returnTo !== null && isSafeReturnPath(returnTo) ? returnTo : defaultReturnPath(),
});

export const passwordIssues = (password: string): FieldIssue[] => {
  const issues: FieldIssue[] = [];
  const at = ["body", "password"];
  if (password.length < signInSecrets.minPasswordLength) {
    issues.push({
      location: at,
      message: `Use at least ${signInSecrets.minPasswordLength} characters`,
      code: "too-short",
    });
  }
  if (signInSecrets.previousPasswords.includes(password)) {
    issues.push({ location: at, message: "You used this password before", code: "reused" });
  }
  if (signInSecrets.leakedPasswords.includes(password)) {
    issues.push({ location: at, message: "This password is in known leaks", code: "leaked" });
  }
  return issues;
};

const passwordSignInSchema = z.object({
  email: z.string(),
  password: z.string(),
  keep_signed_in: z.boolean().optional(),
  return_to: z.string().nullable().optional(),
});

const passwordSignInHandler = () =>
  http.post("*/api/auth/sign-in", async ({ request }) => {
    const parsed = passwordSignInSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    if (parsed.data.password !== signInSecrets.password) {
      return problem(401, "The email or password is wrong", "invalid-credentials");
    }
    markFakeSignIn();
    return HttpResponse.json(landing(parsed.data.return_to ?? null));
  });

const randomChallenge = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

const fakePasskeyUser = "ZmFrZS11c2Vy";

const savedPasskeys: SavedPasskeySummary[] = [];

const knownEmail = (email: string) =>
  Object.values(people).some((person) => person.email.toLowerCase() === email.trim().toLowerCase());

const passkeySignInSchema = z.object({ email: z.string() });
const passkeyFinishSchema = z.object({
  credential: z.looseObject({ id: z.string() }),
  return_to: z.string().nullable().optional(),
});
const newPasskeySchema = z.object({
  passkey: z.string(),
  name: z.string().optional(),
  credential: z.looseObject({ id: z.string() }),
});

const passkeyHandlers = (): RequestHandler[] => [
  http.get("*/api/auth/passkeys", () => HttpResponse.json(savedPasskeys)),
  http.delete("*/api/auth/passkeys/:passkeyId", ({ params }) => {
    const at = savedPasskeys.findIndex((item) => item.id === params.passkeyId);
    if (at < 0) return problem(404, "Not found", "not-found");
    savedPasskeys.splice(at, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("*/api/auth/passkeys/registration", () => {
    const creation: PasskeyCreation = {
      passkey: `passkey-${savedPasskeys.length + 1}`,
      options: {
        challenge: randomChallenge(),
        rp: { id: location.hostname, name: "Parfocal" },
        user: { id: fakePasskeyUser, name: "you@parfocal.test", displayName: "You" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { userVerification: "required" },
        attestation: "none",
      },
    };
    return HttpResponse.json(creation);
  }),
  http.post("*/api/auth/passkeys", async ({ request }) => {
    const parsed = newPasskeySchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    const saved = { id: parsed.data.passkey, name: parsed.data.name ?? "Passkey" };
    savedPasskeys.push(saved);
    return HttpResponse.json(saved);
  }),
  http.post("*/api/auth/passkey-sign-in", async ({ request }) => {
    const parsed = passkeySignInSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    if (!knownEmail(parsed.data.email)) {
      return problem(
        404,
        "No passkey is saved for this email. Sign in with your password, then save one",
        "no-passkey",
      );
    }
    return HttpResponse.json({
      options: {
        challenge: randomChallenge(),
        rpId: location.hostname,
        userVerification: "required",
      },
    });
  }),
  http.post("*/api/auth/passkey-sign-in/finish", async ({ request }) => {
    const parsed = passkeyFinishSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    return HttpResponse.json(landing(parsed.data.return_to ?? null));
  }),
];

export const passwordSignInHandlers = (): RequestHandler[] => [
  passwordSignInHandler(),
  ...passkeyHandlers(),
];
