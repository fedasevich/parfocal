import { HttpResponse, http, type RequestHandler } from "msw";
import { z } from "zod";
import { getGetPasswordSignInMockHandler } from "../generated/api.msw.ts";
import type { AccountCodeSent, SignInLanding } from "../generated/api.ts";
import { passwordIssues } from "./auth-handlers.ts";
import { people } from "./scenario.ts";
import { signInSecrets } from "./scenario-admin.ts";

type FieldIssue = { location: string[]; message: string; code: string };

const problem = (status: number, title: string, code: string, errors?: FieldIssue[]) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code, ...(errors === undefined ? {} : { errors }) },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const unreadable = () => problem(422, "That request is not complete", "invalid-request");

const newAccountSchema = z.object({
  name: z.string(),
  email: z.string(),
  password: z.string(),
  role: z.enum(["run", "review"]),
  accepted_terms: z.boolean(),
});

const emailConfirmationSchema = z.object({ email: z.string(), code: z.string() });

const emailCodeResendSchema = z.object({ email: z.string() });

export const setupAfterSignUp = "/setup?step=role";
export const confirmationCodeMinutes = 30;

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const existingEmails = () => Object.values(people).map((person) => person.email.toLowerCase());

const codeSent = (email: string): AccountCodeSent => ({
  email,
  expires_minutes: confirmationCodeMinutes,
  resend_seconds: signInSecrets.resendSeconds,
});

const createAccountHandler = () =>
  http.post("*/api/auth/sign-up", async ({ request }) => {
    const parsed = newAccountSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
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

const confirmEmailHandler = () =>
  http.post("*/api/auth/sign-up/confirm", async ({ request }) => {
    const parsed = emailConfirmationSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    if (parsed.data.code !== signInSecrets.code) {
      return problem(401, "That code is wrong or has expired", "invalid-code");
    }
    const landing: SignInLanding = { return_to: setupAfterSignUp };
    return HttpResponse.json(landing);
  });

const resendEmailCodeHandler = () =>
  http.post("*/api/auth/sign-up/resend", async ({ request }) => {
    const parsed = emailCodeResendSchema.safeParse(await request.json());
    if (!parsed.success) return unreadable();
    return HttpResponse.json(codeSent(parsed.data.email));
  });

export const signUpHandlers = (): RequestHandler[] => [
  getGetPasswordSignInMockHandler({ available: true }),
  createAccountHandler(),
  confirmEmailHandler(),
  resendEmailCodeHandler(),
];
