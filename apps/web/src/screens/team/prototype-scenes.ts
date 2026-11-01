import type { TeamScene } from "./scenes.ts";

export const teamPrototypeScenes: { scene: TeamScene; label: string; note: string }[] = [
  { scene: "open", label: "Team", note: "Open tasks with a row per reviewer" },
  { scene: "done", label: "Team · done", note: "Signed-off tasks with their reports" },
  { scene: "nudge", label: "Team · nudge", note: "The Nudge modal for Simona on RT-14" },
  { scene: "reassign", label: "Team · reassign", note: "The Reassign modal for Simona's slides" },
  { scene: "sent", label: "Team · RT-16 sent", note: "RT-16 just sent and highlighted" },
  {
    scene: "signoff",
    label: "Team · from sign-off",
    note: "Opened from sign-off, reviews missing",
  },
  { scene: "overdue", label: "Team · overdue", note: "Issue, RT-14 is past its due date" },
  { scene: "away", label: "Team · away", note: "Issue, Anna Kopecká is away" },
  {
    scene: "partial",
    label: "Team · partial reassign",
    note: "Issue, reassigning every slide when 4 have decisions",
  },
];
