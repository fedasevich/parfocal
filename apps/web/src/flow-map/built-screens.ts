import type { WalkScreen } from "./walkthrough.ts";

export type PrototypeScreen = WalkScreen | "settings" | "signin" | "connectmodel" | "layers";

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
]);

export const pendingTask: Partial<Record<PrototypeScreen, string>> = {};

export const isScreenBuilt = (screen: PrototypeScreen) => builtScreens.has(screen);
