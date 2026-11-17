export const minPasswordLength = 12;
export const codeLength = 6;

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

const domainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function organisationDomain(typed: string): string | null {
  const text = typed.trim().toLowerCase();
  const domain = text.includes("@") ? emailDomain(text) : text;
  return domainPattern.test(domain) ? domain : null;
}

export function organisationSignInUrl(domain: string, returnTo: string | null): string {
  const query = new URLSearchParams({ domain, return_to: returnTo ?? "/" });
  return `/api/auth/sso?${query.toString()}`;
}

export function codeCharacters(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, codeLength);
}

export function clock(seconds: number): string {
  const rest = String(seconds % 60).padStart(2, "0");
  return `${Math.floor(seconds / 60)}:${rest}`;
}

export type PasswordFlag = "reused" | "leaked";

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
