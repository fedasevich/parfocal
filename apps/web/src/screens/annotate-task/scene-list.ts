export type TaskScene =
  | "origins"
  | "ai-off"
  | "checking"
  | "checked"
  | "nothing"
  | "signoff"
  | "run"
  | "run-cancelled"
  | "live";

export const taskScenes: { scene: TaskScene; label: string; note: string }[] = [
  {
    scene: "origins",
    label: "Origin marks",
    note: "AI, edited, confirmed and by hand, with the author and history of O15",
  },
  { scene: "ai-off", label: "AI result hidden", note: "Only what the experts drew is left" },
  {
    scene: "checking",
    label: "Checking AI objects",
    note: "Check state per object and 21 of 46 in the progress line",
  },
  { scene: "checked", label: "Slide checked", note: "The checked card with what you did" },
  { scene: "nothing", label: "Nothing to mark", note: "An empty slide checked in one click" },
  {
    scene: "signoff",
    label: "Owner sign-off",
    note: "Three experts checked, two threads still open",
  },
  {
    scene: "run",
    label: "Whole-slide run",
    note: "Finished tiles, progress, estimate and cancel",
  },
  {
    scene: "run-cancelled",
    label: "Run cancelled",
    note: "The finished tiles and their objects are kept",
  },
  {
    scene: "live",
    label: "Colleagues' changes",
    note: "A calm marker instead of shapes moving under the pointer",
  },
];
