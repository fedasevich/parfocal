import { useMemo, useSyncExternalStore } from "react";
import { parseState, type StudyState } from "./study-model.ts";
import { readStudyRaw, subscribeStudy } from "./study-storage.ts";

export function useStudy(): StudyState {
  const raw = useSyncExternalStore(subscribeStudy, () => readStudyRaw());
  return useMemo(() => parseState(raw), [raw]);
}
