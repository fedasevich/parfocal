import type { JoinPolicy, JoinSettings, JoinSettingsChange } from "@parfocal/api-client";

export const logoColours = [
  "#2f6fdf",
  "#1f9d8b",
  "#c2410c",
  "#7c3aed",
  "#be185d",
  "#4d7c0f",
  "#0e7490",
  "#a16207",
] as const;

const publicDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "tuta.com",
  "tutanota.com",
  "posteo.de",
  "hey.com",
  "fastmail.com",
  "zoho.com",
  "mail.com",
  "mail.ru",
  "qq.com",
  "163.com",
  "seznam.cz",
  "email.cz",
  "centrum.cz",
  "wp.pl",
  "o2.pl",
  "interia.pl",
  "ukr.net",
  "i.ua",
  "t-online.de",
  "orange.fr",
  "free.fr",
  "libero.it",
]);
const publicPrefixes = ["hotmail.", "yahoo.", "outlook.", "live.", "gmx.", "web.", "yandex."];
const domainPattern = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const joinPolicyOptions = [
  { value: "join", label: "Join at once" },
  { value: "ask", label: "Ask an admin first" },
] as const satisfies readonly { value: JoinPolicy; label: string }[];

export type JoinDraft = { domain: string; policy: JoinPolicy; logo: string; colour: string };

export type DomainCheck = "none" | "ok" | "invalid" | "public";

export const domainOf = (text: string): string => text.trim().toLowerCase().replace(/^@/, "");

export const isPublicDomain = (domain: string): boolean =>
  publicDomains.has(domain) || publicPrefixes.some((prefix) => domain.startsWith(prefix));

export const checkDomain = (text: string): DomainCheck => {
  const domain = domainOf(text);
  if (domain === "") return "none";
  if (domain.length > 253 || !domainPattern.test(domain)) return "invalid";
  return isPublicDomain(domain) ? "public" : "ok";
};

export const logoOf = (text: string): string =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);

export const draftOf = (saved: JoinSettings): JoinDraft => ({
  domain: saved.email_domain ?? "",
  policy: saved.join_policy,
  logo: saved.logo,
  colour: saved.logo_colour,
});

export const changeOf = (draft: JoinDraft): JoinSettingsChange => ({
  email_domain: domainOf(draft.domain) === "" ? null : domainOf(draft.domain),
  join_policy: draft.policy,
  logo: logoOf(draft.logo) === "" ? null : logoOf(draft.logo),
  logo_colour: draft.colour,
});

export const canSave = (draft: JoinDraft, saved: JoinSettings): boolean => {
  const check = checkDomain(draft.domain);
  if (check === "invalid" || check === "public") return false;
  const change = changeOf(draft);
  return (
    change.email_domain !== saved.email_domain ||
    change.join_policy !== saved.join_policy ||
    (change.logo ?? saved.logo) !== saved.logo ||
    change.logo_colour !== saved.logo_colour
  );
};

export const savedText = (change: JoinSettingsChange): string => {
  if (change.email_domain === null)
    return "No email domain is set, so no one can find the workspace.";
  return change.join_policy === "join"
    ? `People with an @${change.email_domain} email can join at once.`
    : `People with an @${change.email_domain} email can ask to join.`;
};

export const domainHelp: Record<DomainCheck, string> = {
  none: "No one finds the workspace by email. Invite people instead.",
  ok: "People who confirm an email at this domain see the workspace when they set up.",
  invalid: "Enter a domain such as hospital.example, without the @.",
  public: "A public mail domain would open the workspace to anyone. Use your institution's domain.",
};
