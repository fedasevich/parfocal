const uuid = (group: number, index: number) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

export type ScenarioSession = {
  id: string;
  device: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
};

export const sessions: ScenarioSession[] = [
  {
    id: uuid(50, 1),
    device: "MacBook Pro, Chrome",
    current: true,
    createdAt: "2026-10-15T07:40:00+02:00",
    lastSeenAt: "2026-10-15T14:30:00+02:00",
  },
  {
    id: uuid(50, 2),
    device: "Windows workstation in room 214",
    current: false,
    createdAt: "2026-10-14T08:05:00+02:00",
    lastSeenAt: "2026-10-14T16:50:00+02:00",
  },
  {
    id: uuid(50, 3),
    device: "iPad",
    current: false,
    createdAt: "2026-10-12T19:30:00+02:00",
    lastSeenAt: "2026-10-13T21:10:00+02:00",
  },
];

export const noticeChannels: { kind: string; channel: "email" | "bell" | "quiet" }[] = [
  { kind: "task-assigned", channel: "email" },
  { kind: "mention", channel: "bell" },
  { kind: "reply", channel: "bell" },
  { kind: "model-run-finished", channel: "bell" },
  { kind: "task-due-soon", channel: "email" },
];
