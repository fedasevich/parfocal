import type { RoomSignal } from "@parfocal/edge/room-client";

export const submittedStates: ReadonlySet<string> = new Set([
  "submitted",
  "disagreement-queue",
  "signed-off",
  "exported",
]);

type BlindingTask = {
  readonly blinded: boolean;
  readonly ai_hidden_first_read: boolean;
  readonly slides: readonly {
    readonly slide_id: string;
    readonly reviewer_ids: readonly string[];
  }[];
};

export type BlindedFacts = {
  readonly taskId: string | undefined;
  readonly slideId: string;
  readonly me: string | undefined;
  readonly task: BlindingTask | undefined;
  readonly firstReadRecorded: boolean;
  readonly myState: string | undefined;
};

export function blindedOn(facts: BlindedFacts): boolean {
  const { taskId, slideId, me, task } = facts;
  if (taskId === undefined) return false;
  if (task === undefined || me === undefined) return true;
  const assigned = task.slides.some(
    (slide) => slide.slide_id === slideId && slide.reviewer_ids.includes(me),
  );
  if (!assigned) return false;
  if (task.ai_hidden_first_read && !facts.firstReadRecorded) return true;
  return task.blinded && !(facts.myState !== undefined && submittedStates.has(facts.myState));
}

export function endsSharing(signal: RoomSignal): boolean {
  return signal["stop"] === true || signal["gone"] === true;
}

export function sendUnlessBlinded(
  isBlinded: () => boolean,
  send: (signal: RoomSignal) => boolean,
): (signal: RoomSignal) => boolean {
  return (signal) => (isBlinded() && !endsSharing(signal) ? false : send(signal));
}

export function hearUnlessBlinded(
  isBlinded: () => boolean,
  hear: (signal: RoomSignal) => void,
): (signal: RoomSignal) => void {
  return (signal) => {
    if (!isBlinded()) hear(signal);
  };
}
