import type { TeamWorkload } from "@parfocal/api-client";
import type { SceneOf } from "../scenes.ts";
import { mostBehind } from "./team-text.ts";

export type TeamScene = SceneOf<"team">;

export type TeamTab = "open" | "done";

export type TeamSearch = {
  scene?: TeamScene | undefined;
  tab?: TeamTab | undefined;
  project?: string | undefined;
  reviewer?: string | undefined;
  task?: string | undefined;
  focus?: string | undefined;
};

export type TeamState = {
  scene: TeamScene | undefined;
  tab: TeamTab;
  project: string | undefined;
  reviewer: string | undefined;
  task: string | undefined;
  focus: string | undefined;
};

const newestSent = (team: TeamWorkload) =>
  [...team.open].sort((a, b) => b.sent_on.localeCompare(a.sent_on))[0];

export function teamState(search: TeamSearch, team: TeamWorkload | undefined): TeamState {
  const { scene } = search;
  let task = search.task;
  let focus = search.focus;
  if (team && task === undefined && scene === "sent") task = newestSent(team)?.id;
  if (team && task === undefined && scene === "signoff") {
    const first = team.open[0];
    task = first?.id;
    focus = focus ?? (first ? mostBehind(first)?.user_id : undefined);
  }
  return {
    scene,
    tab: search.tab ?? (scene === "done" ? "done" : "open"),
    project: search.project,
    reviewer: search.reviewer,
    task,
    focus,
  };
}
