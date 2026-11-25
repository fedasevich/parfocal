import { HttpResponse, http, type RequestHandler } from "msw";
import {
  getListStudyLinksMockHandler,
  getPrepareStudyLinkMockHandler,
} from "../generated/api.msw.ts";
import type { StudyLinkRow } from "../generated/api.ts";
import { tenant } from "./scenario-admin.ts";
import {
  fakeStudyProjectId,
  fakeStudyWorkspaceName,
  prepareFakeParticipant,
} from "./study-participant.ts";
import { activeFakeWorkspace } from "./workspace-scene.ts";

export const fakeStudyLinksKey = "parfocal.fake.study-links";
const usedTokensKey = "parfocal.fake.study-links-used";
const dayMs = 24 * 60 * 60 * 1000;
const tokenPattern = /^fake-(P-[A-Z0-9-]{1,30})-[a-z0-9]{8,}$/;

function readJson<Value>(key: string, fallback: Value): Value {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as Value);
  } catch {
    return fallback;
  }
}

const writeJson = (key: string, value: unknown) =>
  globalThis.localStorage?.setItem(key, JSON.stringify(value));

const randomPart = () => Math.random().toString(36).slice(2, 12).padEnd(8, "0");

export const fakeStudyLinkToken = (code: string): string =>
  `fake-${code.toUpperCase()}-${randomPart()}`;

export function redeemFakeStudyLink(token: string): string | undefined {
  const code = tokenPattern.exec(token)?.[1];
  const used = readJson<string[]>(usedTokensKey, []);
  if (code === undefined || used.includes(token)) return undefined;
  writeJson(usedTokensKey, [...used, token]);
  prepareFakeParticipant(code);
  const links = readJson<StudyLinkRow[]>(fakeStudyLinksKey, []);
  const at = new Date().toISOString();
  writeJson(
    fakeStudyLinksKey,
    links.map((link) =>
      link.code === code && link.state === "waiting"
        ? { ...link, state: "joined", redeemed_at: at }
        : link,
    ),
  );
  return code;
}

const gone = () =>
  HttpResponse.json(
    {
      type: "about:blank",
      title: "This study link was used already or has expired, ask the moderator for a new one",
      status: 410,
      code: "study-link-gone",
    },
    { status: 410, headers: { "content-type": "application/problem+json" } },
  );

export function studyLinkHandlers(): RequestHandler[] {
  return [
    getPrepareStudyLinkMockHandler(({ params, request }) => {
      const code = String(params.code).toUpperCase();
      prepareFakeParticipant(code);
      const created = new Date();
      const expires = new Date(created.getTime() + dayMs).toISOString();
      const earlier = readJson<StudyLinkRow[]>(fakeStudyLinksKey, []).map((link) =>
        link.code === code && link.state === "waiting"
          ? { ...link, state: "expired" as const, expires_at: created.toISOString() }
          : link,
      );
      const row: StudyLinkRow = {
        code,
        created_at: created.toISOString(),
        expires_at: expires,
        redeemed_at: null,
        state: "waiting",
      };
      writeJson(fakeStudyLinksKey, [row, ...earlier]);
      return {
        code,
        url: `${new URL(request.url).origin}/study/join#${fakeStudyLinkToken(code)}`,
        expires_at: expires,
        project_id: fakeStudyProjectId,
        workspace_id: activeFakeWorkspace() ?? tenant.id,
        workspace_name: fakeStudyWorkspaceName,
      };
    }),
    getListStudyLinksMockHandler(() => ({
      links: readJson<StudyLinkRow[]>(fakeStudyLinksKey, []),
    })),
    http.post("*/api/study-links/redeem", async ({ request }) => {
      const body = (await request.json()) as { token?: unknown };
      const code = typeof body.token === "string" ? redeemFakeStudyLink(body.token) : undefined;
      return code === undefined ? gone() : HttpResponse.json({ code });
    }),
  ];
}
