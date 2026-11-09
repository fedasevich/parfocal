import { HttpResponse, http, type RequestHandler } from "msw";
import {
  getGetJoinSettingsMockHandler,
  getListWorkspaceAccessRequestsMockHandler,
} from "../generated/api.msw.ts";
import type {
  JoinSettings,
  JoinSettingsChange,
  Member,
  PendingAccessRequest,
} from "../generated/api.ts";
import { people, workspaceAsks } from "./scenario.ts";
import { workspaceBrands } from "./scenario-admin.ts";

const publicDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "seznam.cz",
  "email.cz",
  "centrum.cz",
  "mail.com",
  "mail.ru",
]);
const publicPrefixes = ["hotmail.", "yahoo.", "outlook.", "live.", "gmx.", "web.", "yandex."];
const domainPattern = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
const logoPattern = /^[A-Z0-9]{1,3}$/;
const colourPattern = /^#[0-9a-f]{6}$/;

const seededSettings = (): JoinSettings => {
  const brand = workspaceBrands[0];
  return {
    email_domain: brand?.domain ?? null,
    join_policy: "ask",
    logo: brand?.logo ?? "W",
    logo_colour: brand?.colour ?? "#0f766e",
  };
};

let asks: PendingAccessRequest[] = workspaceAsks.map((ask) => ({ ...ask }));
let settings: JoinSettings = seededSettings();

export const resetWorkspaceJoin = () => {
  asks = workspaceAsks.map((ask) => ({ ...ask }));
  settings = seededSettings();
};

export const isPublicDomain = (domain: string) =>
  publicDomains.has(domain) || publicPrefixes.some((prefix) => domain.startsWith(prefix));

const problem = (status: number, code: string, title: string) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const take = (id: string): PendingAccessRequest | undefined => {
  const found = asks.find((ask) => ask.id === id);
  asks = asks.filter((ask) => ask.id !== id);
  return found;
};

const missing = () => problem(404, "access-request-not-found", "There is no such open request");

export function workspaceJoinHandlers(): RequestHandler[] {
  return [
    getListWorkspaceAccessRequestsMockHandler(() => asks),
    http.post("*/api/tenant/access-requests/:requestId/approval", ({ params }) => {
      const ask = take(String(params["requestId"]));
      if (ask === undefined) return missing();
      const member: Member = {
        user_id: ask.user_id,
        display_name: ask.display_name,
        initials: ask.initials,
        avatar_colour: ask.avatar_colour,
        title: ask.title,
        role: "reviewer",
        admin_rights: false,
      };
      return HttpResponse.json<Member>(member);
    }),
    http.delete("*/api/tenant/access-requests/:requestId", ({ params }) =>
      take(String(params["requestId"])) === undefined
        ? missing()
        : new HttpResponse(null, { status: 204 }),
    ),
    getGetJoinSettingsMockHandler(() => settings),
    http.put("*/api/tenant/join-settings", async ({ request }) => {
      const change = (await request.json()) as JoinSettingsChange;
      const domain = change.email_domain?.trim().toLowerCase() ?? null;
      if (domain !== null && (domain.length > 253 || !domainPattern.test(domain))) {
        return problem(422, "invalid-request", "Enter a domain such as lab.example");
      }
      if (domain !== null && isPublicDomain(domain)) {
        return problem(
          400,
          "public-email-domain",
          "A public mail domain cannot let people into a workspace",
        );
      }
      if (domain !== null && domain !== people.DH.email.split("@")[1]) {
        return problem(
          400,
          "domain-not-yours",
          "A workspace can claim only the email domain you confirmed yourself",
        );
      }
      if (change.logo != null && !logoPattern.test(change.logo)) {
        return problem(422, "invalid-request", "A logo is one to three capital letters or digits");
      }
      if (change.logo_colour != null && !colourPattern.test(change.logo_colour)) {
        return problem(422, "invalid-request", "A logo colour is a hex colour");
      }
      settings = {
        email_domain: domain,
        join_policy: change.join_policy,
        logo: change.logo === undefined ? settings.logo : (change.logo ?? seededSettings().logo),
        logo_colour:
          change.logo_colour === undefined
            ? settings.logo_colour
            : (change.logo_colour ?? seededSettings().logo_colour),
      };
      return HttpResponse.json<JoinSettings>(settings);
    }),
  ];
}
