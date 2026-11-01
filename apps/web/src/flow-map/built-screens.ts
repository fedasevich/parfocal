import type { WalkScreen } from "./walkthrough.ts";

export type PrototypeScreen =
  | WalkScreen
  | "settings"
  | "signin"
  | "connectmodel"
  | "layers"
  | "navigator"
  | "measure"
  | "annotate"
  | "compare"
  | "focus"
  | "peek";

export const builtScreens: ReadonlySet<PrototypeScreen> = new Set<PrototypeScreen>([
  "home",
  "project",
  "upload",
  "runmodel",
  "task",
  "team",
  "worklist",
  "guided",
  "gallery",
  "next",
  "creport",
  "cosign",
  "settings",
  "signin",
  "connectmodel",
  "case",
  "layers",
  "disagree",
  "signoff",
  "evaluation",
  "navigator",
  "measure",
  "annotate",
  "compare",
  "focus",
  "peek",
]);

export const pendingTask: Partial<Record<PrototypeScreen, string>> = {};

export const isScreenBuilt = (screen: PrototypeScreen) => builtScreens.has(screen);
