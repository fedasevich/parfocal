import { minPasswordLength } from "./sign-in-rules.ts";

export type SignUpDetails = {
  name: string;
  email: string;
  password: string;
  acceptedTerms: boolean;
};

export const setupAfterSignUp = "/setup?step=role";

export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function signUpProblem(details: SignUpDetails): string | null {
  if (details.name.trim() === "") return "Enter your name.";
  if (!looksLikeEmail(details.email)) return "Enter your work email, like name@institution.org.";
  if (details.password.length < minPasswordLength) {
    return `Use at least ${minPasswordLength} characters for the password.`;
  }
  if (!details.acceptedTerms) return "Agree to the terms and the data processing agreement.";
  return null;
}

export function strengthLine(label: string, password: string): string {
  return password === "" ? "" : `${label} · ${password.length} characters`;
}
