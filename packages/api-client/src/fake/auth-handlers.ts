import { HttpResponse, http, type RequestHandler } from "msw";
import { z } from "zod";
import type { SignInLanding } from "../generated/api.ts";
import { defaultReturnPath, isSafeReturnPath } from "./admin-handlers.ts";
import { signInSecrets } from "./scenario-admin.ts";

type FieldIssue = { location: string[]; message: string; code: string };

const problem = (status: number, title: string, code: string, errors?: FieldIssue[]) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code, ...(errors === undefined ? {} : { errors }) },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const unreadable = () => problem(422, "That request is not complete", "invalid-request");

const landing = (returnTo: string | null): SignInLanding => ({
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
    return HttpResponse.json(landing(parsed.data.return_to ?? null));
  });

export const passwordSignInHandlers = (): RequestHandler[] => [passwordSignInHandler()];
