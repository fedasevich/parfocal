import type { MySettings } from "../draft/get-my-settings.ts";
import { taskDisplay } from "./scenario-review.ts";

const uuid = (group: number, index: number) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

export const mySettings: MySettings = {
  personal: {
    density: "comfortable",
    lengths: "auto",
    language: "en",
    presets: (taskDisplay["RT-14"]?.presets ?? []).map((preset) => preset.name),
    default_preset: "task",
    signature_block: true,
    tools: "left",
    side_panel_width: 340,
    hide_side_panel: false,
    panel_while_moving: "pinned",
    minimap: "useful",
    pinned_slide_strip: false,
    model_warnings: true,
    double_click: "zoom",
    initials_while_sharing: true,
    slide_submitted_notice: "bell",
  },
  shortcuts: {
    preset: "default",
    custom: {},
    single_letter: true,
    by_position: true,
    whole_slide_key: "both",
  },
};

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
