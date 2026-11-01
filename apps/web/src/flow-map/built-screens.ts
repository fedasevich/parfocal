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
]);

export const pendingTask: Partial<Record<PrototypeScreen, string>> = {
  case: "PROTO-018 (full viewer)",
  layers: "PROTO-018 (full viewer)",
  disagree: "PROTO-008 (disagreements, sign-off and the evaluation report)",
  signoff: "PROTO-008 (disagreements, sign-off and the evaluation report)",
  evaluation: "PROTO-008 (disagreements, sign-off and the evaluation report)",
};

export const isScreenBuilt = (screen: PrototypeScreen) => builtScreens.has(screen);
