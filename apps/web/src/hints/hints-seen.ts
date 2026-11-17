import {
  getGetMySettingLayersQueryKey,
  type getMySettingLayersResponse,
  setMySettingLayers,
  useGetMySettingLayers,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

type HintStorage = Pick<Storage, "getItem" | "setItem">;

export const guestHintsKey = "parfocal.hints-seen";
export const mostHints = 200;

const browserStorage = (): HintStorage | undefined => {
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

export function withSeen(seen: readonly string[], ids: readonly string[]): string[] {
  const fresh = ids.filter((id) => !seen.includes(id));
  return fresh.length === 0 ? [...seen] : [...seen, ...fresh].slice(-mostHints);
}

export function readGuestHints(storage: HintStorage | undefined = browserStorage()): string[] {
  try {
    return hintIds(JSON.parse(storage?.getItem(guestHintsKey) ?? "[]"));
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

export type HintsSeen = {
  ready: boolean;
  seen: ReadonlySet<string>;
  markSeen: (ids: readonly string[]) => void;
  showAllAgain: () => void;
};

const serverSeen = (response: getMySettingLayersResponse | undefined): string[] | undefined =>
  response?.status === 200 ? hintIds(response.data.personal["hints_seen"]) : undefined;

export function useHintsSeen(): HintsSeen {
  const queryClient = useQueryClient();
  const query = useGetMySettingLayers();
  const server = serverSeen(query.data);
  const [guest, setGuest] = useState<string[]>(() => readGuestHints());
  const signedIn = server !== undefined;
  const list = server ?? guest;

  const store = useCallback(
    (next: (current: string[]) => string[]) => {
      const key = getGetMySettingLayersQueryKey();
      const cached = queryClient.getQueryData<getMySettingLayersResponse>(key);
      const current = serverSeen(cached);
      if (current === undefined || cached?.status !== 200) {
        const updated = next(readGuestHints());
        writeGuestHints(updated);
        setGuest(updated);
        return;
      }
      const updated = next(current);
      if (updated.length === current.length && updated.every((id, at) => id === current[at])) {
        return;
      }
      queryClient.setQueryData<getMySettingLayersResponse>(key, {
        ...cached,
        data: { ...cached.data, personal: { ...cached.data.personal, hints_seen: updated } },
      });
      void setMySettingLayers({ values: { hints_seen: updated } })
        .catch(() => undefined)
        .finally(() => void queryClient.invalidateQueries({ queryKey: key }));
    },
    [queryClient],
  );

  const markSeen = useCallback(
    (ids: readonly string[]) => {
      if (ids.length > 0) store((current) => withSeen(current, ids));
    },
    [store],
  );
  const showAllAgain = useCallback(() => store(() => []), [store]);
  const joined = list.join("\n");
  const seen = useMemo(() => new Set(joined === "" ? [] : joined.split("\n")), [joined]);

  return { ready: signedIn || !query.isPending, seen, markSeen, showAllAgain };
}
