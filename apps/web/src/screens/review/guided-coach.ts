import { useCallback, useState } from "react";
import { guidedCoachHintId, useHintsSeen } from "../../hints/hints-seen.ts";

export const coachShown = (asked: boolean, objectCount: number, answerable: boolean) =>
  answerable && asked && objectCount > 0;

export type GuidedCoach = { open: boolean; dismiss: () => void; reopen: () => void };

export function useGuidedCoach(firstVisitAllowed: boolean): GuidedCoach {
  const { ready, seen, markSeen } = useHintsSeen();
  const [reopened, setReopened] = useState(false);
  const dismiss = useCallback(() => {
    setReopened(false);
    markSeen([guidedCoachHintId]);
  }, [markSeen]);
  const reopen = useCallback(() => setReopened(true), []);
  const firstVisit = ready && !seen.has(guidedCoachHintId);
  return { open: reopened || (firstVisitAllowed && firstVisit), dismiss, reopen };
}
