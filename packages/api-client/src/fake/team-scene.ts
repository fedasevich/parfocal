import type { PersonKey } from "./scenario.ts";

export type FakeTeamScene = {
  now: "scenario" | "overdue";
  away: PersonKey | null;
  sent: boolean;
};

export const defaultFakeTeamScene: FakeTeamScene = { now: "scenario", away: null, sent: false };

export type FakeNudge = { id: string; task: string; to: PersonKey; message: string; at: string };

export type FakeReassignment = {
  id: string;
  task: string;
  from: PersonKey;
  to: PersonKey;
  what: "not-started" | "all";
  slides: number;
  note: string | null;
};

type TeamActions = { nudges: FakeNudge[]; reassignments: FakeReassignment[]; next: number };

let scene: FakeTeamScene = defaultFakeTeamScene;
let actions: TeamActions = { nudges: [], reassignments: [], next: 1 };

export function fakeTeamScene(): FakeTeamScene {
  return scene;
}

export function teamActions(): TeamActions {
  return actions;
}

export function resetTeamActions(): void {
  actions = { nudges: [], reassignments: [], next: 1 };
}

export function setFakeTeamScene(next: FakeTeamScene): boolean {
  if (next.now === scene.now && next.away === scene.away && next.sent === scene.sent) return false;
  scene = next;
  resetTeamActions();
  return true;
}

export function nextActionId(group: number): string {
  const index = actions.next;
  actions.next += 1;
  return `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;
}
