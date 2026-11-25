import type { ServerSession } from "./study-results.ts";

export type LinkRow = {
  code: string;
  state: "waiting" | "joined" | "expired";
  expires_at: string;
  redeemed_at?: string | null | undefined;
};

export type RemoteProgress =
  | { code: string; kind: "waiting"; expiresAt: string }
  | { code: string; kind: "expired" }
  | { code: string; kind: "joined" }
  | { code: string; kind: "working"; done: number; total: number; updatedAt: string }
  | { code: string; kind: "finished"; total: number; updatedAt: string };

const latestOf = (sessions: readonly ServerSession[], code: string): ServerSession | undefined =>
  sessions
    .filter((entry) => entry.participant === code)
    .reduce<ServerSession | undefined>(
      (latest, entry) =>
        latest === undefined || entry.updatedAt > latest.updatedAt ? entry : latest,
      undefined,
    );

function progressOf(link: LinkRow, sessions: readonly ServerSession[], total: number) {
  const latest = latestOf(sessions, link.code);
  if (latest?.session !== undefined) {
    const { session, updatedAt } = latest;
    if (session.final?.finishedAt != null) {
      return { code: link.code, kind: "finished", total, updatedAt } as const;
    }
    const done = Math.min(session.tasks?.length ?? 0, total);
    return { code: link.code, kind: "working", done, total, updatedAt } as const;
  }
  if (link.state === "joined") return { code: link.code, kind: "joined" } as const;
  if (link.state === "expired") return { code: link.code, kind: "expired" } as const;
  return { code: link.code, kind: "waiting", expiresAt: link.expires_at } as const;
}

export function remoteProgress(
  links: readonly LinkRow[],
  sessions: readonly ServerSession[],
  total: number,
): RemoteProgress[] {
  const seen = new Set<string>();
  const rows: RemoteProgress[] = [];
  for (const link of links) {
    if (seen.has(link.code)) continue;
    seen.add(link.code);
    rows.push(progressOf(link, sessions, total));
  }
  return rows;
}

export function joinToken(hash: string): string | undefined {
  const token = hash.startsWith("#") ? hash.slice(1) : hash;
  return /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : undefined;
}
