import { useGetMe } from "@parfocal/api-client";
import { useFlowSteps } from "@parfocal/ui/components/flow-page";
import { type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { keepDraft, readDraft } from "./kept-drafts.ts";

type Kept<Draft> = { current: number; reached: number; draft: Draft };

type Options<Draft> = {
  owner: string | undefined;
  id: string;
  count: number;
  draft: Draft;
  at?: number | undefined;
  keep?: boolean;
  persist?: (draft: Draft) => Draft;
  restore?: (saved: Draft) => Draft;
};

export function useFlowOwner(): string | undefined {
  return okData(useGetMe().data)?.user_id;
}

export function readKeptFlow<Draft>(
  owner: string | undefined,
  id: string,
): Kept<Draft> | undefined {
  if (owner === undefined) return undefined;
  const raw = readDraft(owner, id);
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<Kept<Draft>> | null;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof parsed.current !== "number" ||
      typeof parsed.reached !== "number" ||
      !("draft" in parsed)
    ) {
      return undefined;
    }
    return parsed as Kept<Draft>;
  } catch {
    return undefined;
  }
}

export function useKeptFlow<Draft>({
  owner,
  id,
  count,
  draft: initial,
  at,
  keep = true,
  persist = (value) => value,
  restore = (value) => value,
}: Options<Draft>) {
  const [kept] = useState(() => (keep ? readKeptFlow<Draft>(owner, id) : undefined));
  const startAt = at ?? kept?.current ?? 0;
  const steps = useFlowSteps(count, {
    current: startAt,
    reached: Math.max(kept?.reached ?? 0, startAt),
  });
  const [draft, setDraftState] = useState<Draft>(() => (kept ? restore(kept.draft) : initial));
  const dropped = useRef(false);
  const { sync } = steps;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const setDraft = useCallback((next: SetStateAction<Draft>) => setDraftState(next), []);

  useEffect(() => {
    if (at !== undefined) sync(at);
  }, [at, sync]);

  useEffect(() => {
    if (!keep || owner === undefined || dropped.current) return;
    keepDraft(
      owner,
      id,
      JSON.stringify({
        current: steps.current,
        reached: steps.reached,
        draft: persistRef.current(draft),
      } satisfies Kept<Draft>),
    );
  }, [keep, owner, id, steps.current, steps.reached, draft]);

  const forget = useCallback(() => {
    dropped.current = true;
    if (owner !== undefined) keepDraft(owner, id, "");
  }, [owner, id]);

  return { ...steps, draft, setDraft, restored: kept !== undefined, kept, forget };
}
