import { getTileAccess } from "@parfocal/api-client";

export type SlideStorageNote = {
  readonly storage: "uploaded" | "remote";
  readonly offline: boolean;
};

export type Grant = SlideStorageNote & {
  readonly token: string;
  readonly lifetimeSeconds: number;
  readonly basePath: string;
  readonly original: string;
  readonly format: string | null;
};

export const primedGrantLifetimeMs = 30_000;

type Asker = (slideId: string, previous: string | null) => Promise<Grant>;

type Primed = { readonly slideId: string; readonly at: number; readonly grant: Promise<Grant> };

let primed: Primed | null = null;

export function primeGrant(slideId: string, ask: Asker = grantFor, now = Date.now()): void {
  const grant = ask(slideId, null);
  grant.catch(() => {});
  primed = { slideId, at: now, grant };
}

export function firstGrant(
  slideId: string,
  ask: Asker = grantFor,
  now = Date.now(),
): Promise<Grant> {
  const taken = primed;
  primed = null;
  if (taken === null || taken.slideId !== slideId || now - taken.at > primedGrantLifetimeMs) {
    return ask(slideId, null);
  }
  return taken.grant.catch(() => ask(slideId, null));
}

export async function grantFor(slideId: string, previous: string | null): Promise<Grant> {
  const response = await getTileAccess(
    slideId,
    previous === null ? undefined : { headers: { "Previous-Tile-Token": previous } },
  );
  if (response.status !== 200) throw new Error(`tile-access answered ${response.status}`);
  const access = response.data;
  return {
    token: access.token,
    lifetimeSeconds: access.lifetime_seconds,
    basePath: access.base_path,
    original: access.original,
    format: access.format,
    storage: access.storage ?? "uploaded",
    offline: access.offline ?? false,
  };
}
