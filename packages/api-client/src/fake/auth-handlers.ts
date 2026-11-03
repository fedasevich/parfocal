import { HttpResponse, http } from "msw";
import { requestPasswordResetDraftSchema } from "../draft/request-password-reset.ts";
import { requestSignInLinkDraftSchema } from "../draft/request-sign-in-link.ts";
import { resetPasswordDraftSchema } from "../draft/reset-password.ts";
import {
  type PasswordResetSent,
  passwordResetSentSchema,
  type SignInLinkSent,
  type SignInSession,
  signInLinkSentSchema,
  signInSessionSchema,
} from "../draft/sign-in-session.ts";
import { signInWithCodeDraftSchema } from "../draft/sign-in-with-code.ts";
import { signInWithPasswordDraftSchema } from "../draft/sign-in-with-password.ts";
import { startSsoDraftSchema } from "../draft/start-sso.ts";
import { defaultReturnPath, isSafeReturnPath } from "./admin-handlers.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { signInSecrets } from "./scenario-admin.ts";

type FieldIssue = { location: string[]; message: string; code: string };

const problem = (status: number, title: string, code: string, errors?: FieldIssue[]) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code, ...(errors === undefined ? {} : { errors }) },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const unreadable = () => problem(422, "That request is not complete", "invalid-request");

const landing = (returnTo: string | null): SignInSession =>
  signInSessionSchema.parse({
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

export const getSignInWithPasswordMockHandler = (overrideResponse?: SignInSession) =>
  http.post("*/api/auth/sign-in", async ({ request }) => {
    const parsed = signInWithPasswordDraftSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    if (overrideResponse) return HttpResponse.json(overrideResponse);
    if (parsed.data.password !== signInSecrets.password) {
      return problem(401, "The email or password is wrong", "invalid-credentials");
    }
    return HttpResponse.json(landing(parsed.data.return_to));
  });

export const getRequestSignInLinkMockHandler = (overrideResponse?: SignInLinkSent) =>
  http.post("*/api/auth/sign-in-link", async ({ request }) => {
    const parsed = requestSignInLinkDraftSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    return HttpResponse.json(
      overrideResponse ??
        signInLinkSentSchema.parse({
          email: parsed.data.email,
          expires_minutes: signInSecrets.linkMinutes,
          resend_seconds: signInSecrets.resendSeconds,
        }),
    );
  });

export const getSignInWithCodeMockHandler = (overrideResponse?: SignInSession) =>
  http.post("*/api/auth/sign-in-code", async ({ request }) => {
    const parsed = signInWithCodeDraftSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    if (overrideResponse) return HttpResponse.json(overrideResponse);
    if (parsed.data.code !== signInSecrets.code) {
      return problem(401, "That code is wrong or has expired", "invalid-code");
    }
    return HttpResponse.json(landing(parsed.data.return_to));
  });

export const getStartSsoMockHandler = (overrideResponse?: SignInSession) =>
  http.post("*/api/auth/sso", async ({ request }) => {
    const parsed = startSsoDraftSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    return HttpResponse.json(overrideResponse ?? landing(parsed.data.return_to));
  });

export const getRequestPasswordResetMockHandler = (overrideResponse?: PasswordResetSent) =>
  http.post("*/api/auth/password-reset", async ({ request }) => {
    const parsed = requestPasswordResetDraftSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    return HttpResponse.json(
      overrideResponse ?? passwordResetSentSchema.parse({ email: parsed.data.email }),
    );
  });

export const getResetPasswordMockHandler = (overrideResponse?: SignInSession) =>
  http.post("*/api/auth/password-reset/confirm", async ({ request }) => {
    const parsed = resetPasswordDraftSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    if (overrideResponse) return HttpResponse.json(overrideResponse);
    const issues = passwordIssues(parsed.data.password);
    if (issues.length > 0) {
      return problem(422, "Choose a different password", "weak-password", issues);
    }
    return HttpResponse.json(landing(parsed.data.return_to));
  });

export const authDraftOperations: DraftOperation[] = [
  {
    operationId: "signInWithPassword",
    method: "post",
    path: "/api/auth/sign-in",
    handler: () => getSignInWithPasswordMockHandler(),
  },
  {
    operationId: "requestSignInLink",
    method: "post",
    path: "/api/auth/sign-in-link",
    handler: () => getRequestSignInLinkMockHandler(),
  },
  {
    operationId: "signInWithCode",
    method: "post",
    path: "/api/auth/sign-in-code",
    handler: () => getSignInWithCodeMockHandler(),
  },
  {
    operationId: "startSso",
    method: "post",
    path: "/api/auth/sso",
    handler: () => getStartSsoMockHandler(),
  },
  {
    operationId: "requestPasswordReset",
    method: "post",
    path: "/api/auth/password-reset",
    handler: () => getRequestPasswordResetMockHandler(),
  },
  {
    operationId: "resetPassword",
    method: "post",
    path: "/api/auth/password-reset/confirm",
    handler: () => getResetPasswordMockHandler(),
  },
];
