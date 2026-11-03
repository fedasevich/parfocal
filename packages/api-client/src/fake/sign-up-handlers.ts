import { HttpResponse, http } from "msw";
import { confirmEmailDraftSchema } from "../draft/confirm-email.ts";
import { createAccountDraftSchema } from "../draft/create-account.ts";
import { resendEmailCodeDraftSchema } from "../draft/resend-email-code.ts";
import { type SignInSession, signInSessionSchema } from "../draft/sign-in-session.ts";
import { type AccountCodeSent, accountCodeSentSchema } from "../draft/sign-up-session.ts";
import { passwordIssues } from "./auth-handlers.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { people } from "./scenario.ts";
import { signInSecrets } from "./scenario-admin.ts";

type FieldIssue = { location: string[]; message: string; code: string };

const problem = (status: number, title: string, code: string, errors?: FieldIssue[]) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code, ...(errors === undefined ? {} : { errors }) },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const unreadable = () => problem(422, "That request is not complete", "invalid-request");

export const setupAfterSignUp = "/setup?step=role";
export const confirmationCodeMinutes = 30;

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const existingEmails = () => Object.values(people).map((person) => person.email.toLowerCase());

const codeSent = (email: string): AccountCodeSent =>
  accountCodeSentSchema.parse({
    email,
    expires_minutes: confirmationCodeMinutes,
    resend_seconds: signInSecrets.resendSeconds,
  });

export const getCreateAccountMockHandler = (overrideResponse?: AccountCodeSent) =>
  http.post("*/api/auth/sign-up", async ({ request }) => {
    const parsed = createAccountDraftSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    if (overrideResponse) return HttpResponse.json(overrideResponse);
    const { name, email, password, accepted_terms } = parsed.data;
    const issues: FieldIssue[] = [];
    if (name.trim() === "") {
      issues.push({ location: ["body", "name"], message: "Enter your name", code: "required" });
    }
    if (!looksLikeEmail(email)) {
      issues.push({
        location: ["body", "email"],
        message: "Enter an email like name@institution.org",
        code: "invalid-email",
      });
    }
    issues.push(...passwordIssues(password));
    if (!accepted_terms) {
      issues.push({
        location: ["body", "accepted_terms"],
        message: "Agree to the terms to create an account",
        code: "terms-required",
      });
    }
    if (issues.length > 0) {
      return problem(422, "Check the highlighted details", "invalid-account", issues);
    }
    if (existingEmails().includes(email.trim().toLowerCase())) {
      return problem(409, "This email already has an account. Sign in instead", "account-exists");
    }
    return HttpResponse.json(codeSent(email.trim()));
  });

export const getConfirmEmailMockHandler = (overrideResponse?: SignInSession) =>
  http.post("*/api/auth/sign-up/confirm", async ({ request }) => {
    const parsed = confirmEmailDraftSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    if (overrideResponse) return HttpResponse.json(overrideResponse);
    if (parsed.data.code !== signInSecrets.code) {
      return problem(401, "That code is wrong or has expired", "invalid-code");
    }
    return HttpResponse.json(signInSessionSchema.parse({ return_to: setupAfterSignUp }));
  });

export const getResendEmailCodeMockHandler = (overrideResponse?: AccountCodeSent) =>
  http.post("*/api/auth/sign-up/resend", async ({ request }) => {
    const parsed = resendEmailCodeDraftSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    return HttpResponse.json(overrideResponse ?? codeSent(parsed.data.email));
  });

export const signUpDraftOperations: DraftOperation[] = [
  {
    operationId: "createAccount",
    method: "post",
    path: "/api/auth/sign-up",
    handler: () => getCreateAccountMockHandler(),
  },
  {
    operationId: "confirmEmail",
    method: "post",
    path: "/api/auth/sign-up/confirm",
    handler: () => getConfirmEmailMockHandler(),
  },
  {
    operationId: "resendEmailCode",
    method: "post",
    path: "/api/auth/sign-up/resend",
    handler: () => getResendEmailCodeMockHandler(),
  },
];
