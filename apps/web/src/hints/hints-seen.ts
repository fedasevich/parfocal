import {
  getGetMySettingLayersQueryKey,
  type getMySettingLayersResponse,
  setMySettingLayers,
  useGetMySettingLayers,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

type HintStorage = Pick<Storage, "getItem" | "setItem">;
type LegacyStorage = HintStorage & Partial<Pick<Storage, "removeItem">>;

export const guestHintsKey = "parfocal.hints-seen";
export const mostHints = 200;

const localChange = "parfocal:hints-seen";
const legacyKeys = [
  "parfocal.tool-hints-seen",
  "parfocal.guided-coach",
  "parfocal.checklist-tried",
] as const;

export const toolHintId = (tool: string) => `viewer.tool.${tool}`;
export const guidedCoachHintId = "coach.guided";
export const checklistHintPrefix = "checklist.";
export const checklistHintId = (step: string) => `${checklistHintPrefix}${step}`;

const browserStorage = (): LegacyStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const hintIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];

const parseList = (raw: string | null | undefined): string[] => {
  try {
    return hintIds(JSON.parse(raw ?? "[]"));
  } catch {
    return [];
  }
};

export function withSeen(seen: readonly string[], ids: readonly string[]): string[] {
  const fresh = ids.filter((id) => !seen.includes(id));
  return fresh.length === 0 ? [...seen] : [...seen, ...fresh].slice(-mostHints);
}

export function withoutSeen(seen: readonly string[], ids: readonly string[]): string[] {
  return seen.filter((id) => !ids.includes(id));
}

export function readGuestHints(storage: HintStorage | undefined = browserStorage()): string[] {
  try {
    return parseList(storage?.getItem(guestHintsKey));
  } catch {
    return [];
  }
}

export function writeGuestHints(
  ids: readonly string[],
  storage: HintStorage | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(guestHintsKey, JSON.stringify(ids));
  } catch {}
}

const notifyLocal = () => {
  try {
    window.dispatchEvent(new Event(localChange));
  } catch {}
};

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, at) => id === b[at]);

export function noteHintsSeen(
  ids: readonly string[],
  storage: HintStorage | undefined = browserStorage(),
): void {
  const current = readGuestHints(storage);
  const next = withSeen(current, ids);
  if (sameList(current, next)) return;
  writeGuestHints(next, storage);
  notifyLocal();
}

const guidedCoachWasSeen = (raw: string | null | undefined): boolean => {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.values(parsed).some((value) => value === true)
    );
  } catch {
    return false;
  }
};

const readKey = (storage: HintStorage, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export function legacyHintIds(storage: HintStorage | undefined = browserStorage()): string[] {
  if (storage === undefined) return [];
  const [tools, coach, checklist] = legacyKeys.map((key) => readKey(storage, key));
  return [
    ...parseList(tools).map(toolHintId),
    ...(guidedCoachWasSeen(coach) ? [guidedCoachHintId] : []),
    ...parseList(checklist).map(checklistHintId),
  ];
}

export function foldLegacyHints(storage: LegacyStorage | undefined = browserStorage()): void {
  if (storage === undefined) return;
  if (legacyKeys.every((key) => readKey(storage, key) === null)) return;
  noteHintsSeen(legacyHintIds(storage), storage);
  for (const key of legacyKeys) {
    try {
      storage.removeItem?.(key);
    } catch {}
  }
}

foldLegacyHints();

let localRaw: string | null | undefined;
let localList: string[] = [];
const noLocalHints: string[] = [];

const subscribeLocal = (onChange: () => void) => {
  window.addEventListener(localChange, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(localChange, onChange);
    window.removeEventListener("storage", onChange);
  };
};

const localSnapshot = (): string[] => {
  const storage = browserStorage();
  const raw = storage === undefined ? null : readKey(storage, guestHintsKey);
  if (raw !== localRaw) {
    localRaw = raw;
    localList = parseList(raw);
  }
  return localList;
};

export function unwrittenHints(written: ReadonlySet<string>, ids: readonly string[]): string[] {
  return ids.filter((id) => !written.has(id));
}

let written: ReadonlySet<string> = new Set();

export type HintWrites = {
  pending: () => string[] | null;
  push: (ids: string[], settled: () => void) => void;
};

export function hintWrites(send: (ids: string[]) => Promise<unknown>): HintWrites {
  let latest: string[] | null = null;
  let waiting = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    pending: () => latest,
    push: (ids, settled) => {
      latest = ids;
      waiting += 1;
      chain = chain
        .then(() => send(ids))
        .catch(() => undefined)
        .then(() => {
          waiting -= 1;
          if (waiting > 0) return;
          latest = null;
          settled();
        });
    },
  };
}

const serverWrites = hintWrites((ids) => setMySettingLayers({ values: { hints_seen: ids } }));

export type HintsSeen = {
  ready: boolean;
  seen: ReadonlySet<string>;
  markSeen: (ids: readonly string[]) => void;
  showAllAgain: () => void;
  showAgain: (ids: readonly string[]) => void;
};

const serverSeen = (response: getMySettingLayersResponse | undefined): string[] | undefined =>
  response?.status === 200 ? hintIds(response.data.personal["hints_seen"]) : undefined;

export function useHintsSeen(): HintsSeen {
  const queryClient = useQueryClient();
  const query = useGetMySettingLayers();
  const server = serverSeen(query.data);
  const local = useSyncExternalStore(subscribeLocal, localSnapshot, () => noLocalHints);
  const signedIn = server !== undefined;

  const store = useCallback(
    (next: (current: string[]) => string[]) => {
      const key = getGetMySettingLayersQueryKey();
      const cached = queryClient.getQueryData<getMySettingLayersResponse>(key);
      const fetched = serverSeen(cached);
      if (fetched === undefined || cached?.status !== 200) {
        const before = readGuestHints();
        const updated = next(before);
        if (sameList(before, updated)) return;
        writeGuestHints(updated);
        notifyLocal();
        return;
      }
      const current = serverWrites.pending() ?? fetched;
      const updated = next(current);
      if (sameList(current, updated)) return;
      written = new Set(updated);
      void queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<getMySettingLayersResponse>(key, {
        ...cached,
        data: { ...cached.data, personal: { ...cached.data.personal, hints_seen: updated } },
      });
      serverWrites.push(updated, () => void queryClient.invalidateQueries({ queryKey: key }));
    },
    [queryClient],
  );

  const markSeen = useCallback(
    (ids: readonly string[]) => {
      if (unwrittenHints(written, ids).length > 0) store((current) => withSeen(current, ids));
    },
    [store],
  );
  const showAllAgain = useCallback(() => {
    if (readGuestHints().length > 0) {
      writeGuestHints([]);
      notifyLocal();
    }
    store(() => []);
  }, [store]);
  const showAgain = useCallback(
    (ids: readonly string[]) => {
      const guest = readGuestHints();
      const remaining = withoutSeen(guest, ids);
      if (!sameList(guest, remaining)) {
        writeGuestHints(remaining);
        notifyLocal();
      }
      store((current) => withoutSeen(current, ids));
    },
    [store],
  );
  const joined = [...(server ?? []), ...local].join("\n");
  const seen = useMemo(() => new Set(joined === "" ? [] : joined.split("\n")), [joined]);

  useEffect(() => {
    if (!signedIn || local.length === 0) return;
    writeGuestHints([]);
    notifyLocal();
    store((current) => withSeen(current, local));
  }, [signedIn, local, store]);

  return { ready: signedIn || !query.isPending, seen, markSeen, showAllAgain, showAgain };
}
