import { announcements, type ScenarioAnnouncement, scenarioNow, uuid } from "./scenario.ts";

type Draft = Pick<ScenarioAnnouncement, "kind" | "text" | "endsAt"> & { createdBy: string };

let posted: ScenarioAnnouncement[] = [];
let ended = new Set<string>();

export const isCurrent = (item: ScenarioAnnouncement, at: string) =>
  item.endsAt === null || Date.parse(item.endsAt) > Date.parse(at);

export function resetAnnouncementBoard(): void {
  posted = [];
  ended = new Set();
}

export const currentAnnouncements = (): ScenarioAnnouncement[] =>
  [...posted.filter((item) => isCurrent(item, scenarioNow)), ...announcements].filter(
    (item) => !ended.has(item.id),
  );

export function postAnnouncement(draft: Draft): ScenarioAnnouncement {
  const item: ScenarioAnnouncement = {
    id: uuid(11, 100 + posted.length),
    kind: draft.kind,
    text: draft.text,
    createdAt: scenarioNow,
    endsAt: draft.endsAt,
    createdBy: draft.createdBy,
  };
  posted = [item, ...posted];
  return item;
}

export function endAnnouncement(id: string): ScenarioAnnouncement | undefined {
  const found = [...posted, ...announcements].find((item) => item.id === id);
  if (found === undefined) return undefined;
  ended.add(id);
  return { ...found, endsAt: scenarioNow };
}
