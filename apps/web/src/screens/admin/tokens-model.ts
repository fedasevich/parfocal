import type { ApiToken, ServiceAccount, ServiceScope } from "@parfocal/api-client";

export const TOKEN_DAYS = 90;

export const SCOPES: { key: ServiceScope; label: string }[] = [
  { key: "see-slides", label: "See slides" },
  { key: "create-cases", label: "Create cases" },
  { key: "upload-slides", label: "Upload slides and results" },
  { key: "see-people", label: "See people" },
];

export const scopeNames = (scopes: readonly ServiceScope[]): string =>
  SCOPES.filter((scope) => scopes.includes(scope.key))
    .map((scope) => scope.label)
    .join(", ");

export type TokenRow = { account: ServiceAccount; token: ApiToken };

export const liveTokens = (accounts: readonly ServiceAccount[], at = new Date()): TokenRow[] =>
  accounts
    .filter((account) => account.disabled_at === null)
    .flatMap((account) =>
      account.tokens
        .filter((token) => token.revoked_at === null && new Date(token.expires_at) > at)
        .map((token) => ({ account, token })),
    );

export function tokenDraftError(name: string, scopes: readonly ServiceScope[]): string | null {
  if (name.trim() === "") return "Name the pipeline that uses the token";
  if (name.trim().length > 100) return "Keep the name under 100 characters";
  if (scopes.length === 0) return "Pick at least one thing the token can do";
  return null;
}
