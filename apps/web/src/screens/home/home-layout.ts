import type { SettingValues } from "@parfocal/api-client";

export type HomeLayoutChoice = SettingValues["home_layout"];
export type HomeLayout = Exclude<HomeLayoutChoice, "role">;
export type SetupRole = "res" | "rev" | "both";
export type HomeBlock = "continue" | "start" | "projects";
export type SideBlock = "week" | "tasks";

export const homeLayoutOfSetup: Record<SetupRole, HomeLayout> = {
  res: "research",
  rev: "review",
  both: "both",
};

export const homeLayoutFor = (
  choice: HomeLayoutChoice,
  workspaceRole: "researcher" | "reviewer" | undefined,
): HomeLayout => {
  if (choice !== "role") return choice;
  return workspaceRole === "researcher" ? "research" : "review";
};

export const homeBlocks: Record<HomeLayout, readonly HomeBlock[]> = {
  review: ["continue", "projects", "start"],
  research: ["start", "projects", "continue"],
  both: ["continue", "start", "projects"],
};

export const sideBlocks: Record<HomeLayout, readonly SideBlock[]> = {
  review: ["tasks", "week"],
  research: ["week", "tasks"],
  both: ["week", "tasks"],
};

export const homeLayoutOptions: { value: HomeLayoutChoice; label: string }[] = [
  { value: "role", label: "From my role" },
  { value: "review", label: "Reviewing first" },
  { value: "research", label: "Projects first" },
  { value: "both", label: "Side by side" },
];
