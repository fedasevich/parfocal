import type { PersonKey } from "./scenario.ts";
import { scenarioNow } from "./scenario.ts";
import { newTask } from "./scenario-task.ts";

export const teamNow = scenarioNow;

export const overdueNow = "2026-10-24T09:00:00+02:00";

export const lastDecisions: { task: string; by: PersonKey; at: string }[] = [
  { task: "RT-14", by: "LM", at: "2026-10-15T14:20:00+02:00" },
  { task: "RT-14", by: "SM", at: "2026-10-14T16:40:00+02:00" },
];

export const awaySceneAbsence: { key: PersonKey; until: string } = {
  key: "AK",
  until: "2026-10-19",
};

export const sentTaskAt = `${newTask.sentOn}T14:30:00+02:00`;

export const minutesPerSlide = 20;
