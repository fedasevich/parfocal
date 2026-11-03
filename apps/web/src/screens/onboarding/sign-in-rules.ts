import type { FieldError, SignInOptions } from "@parfocal/api-client";

export const minPasswordLength = 12;
export const codeLength = 6;
export const defaultResendSeconds = 42;

type Institution = SignInOptions["institutions"][number];

export function safeReturnPath(value: string | undefined): string | null {
  if (value === undefined) return null;
  const unsafe =
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.split("").some((character) => character.charCodeAt(0) < 0x20);
  return unsafe ? null : value;
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0
    ? ""
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

export function institutionFor(
  email: string,
  institutions: Institution[],
): Institution | undefined {
  const domain = emailDomain(email);
  if (domain === "") return undefined;
  return institutions.find((item) => item.domain.toLowerCase() === domain);
}

export function matchingInstitutions(text: string, institutions: Institution[]): Institution[] {
  const needle = text.trim().toLowerCase();
  if (needle === "") return institutions;
  return institutions.filter((item) =>
    [item.name, item.short_name, item.domain].some((part) => part.toLowerCase().includes(needle)),
  );
}

export function codeDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, codeLength);
}

export function clock(seconds: number): string {
  const rest = String(seconds % 60).padStart(2, "0");
  return `${Math.floor(seconds / 60)}:${rest}`;
}

export type PasswordFlag = "reused" | "leaked";

export function flagsOf(errors: FieldError[]): PasswordFlag[] {
  const flags: PasswordFlag[] = [];
  for (const error of errors) {
    if (error.code === "reused" || error.code === "leaked") flags.push(error.code);
  }
  return flags;
}

export type PasswordCheck = {
  strength: 0 | 1 | 2 | 3 | 4;
  label: string;
  requirements: { text: string; met: boolean }[];
};

export function checkPassword(password: string, flags: PasswordFlag[]): PasswordCheck {
  const typed = password.length > 0;
  const long = password.length >= minPasswordLength;
  const strength = !typed
    ? 0
    : !long || flags.length > 0
      ? 1
      : password.length < 16
        ? 2
        : password.length < 20
          ? 3
          : 4;
  const labels = ["", "Weak", "Fair", "Strong", "Very strong"] as const;
  return {
    strength,
    label: labels[strength],
    requirements: [
      { text: `At least ${minPasswordLength} characters`, met: long },
      { text: "Not one you used before", met: typed && !flags.includes("reused") },
      { text: "Not found in known leaks", met: typed && !flags.includes("leaked") },
    ],
  };
}
