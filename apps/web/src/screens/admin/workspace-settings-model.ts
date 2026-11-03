import type {
  AnnouncementKind,
  LabSettings,
  ModelTier,
  TierMapping,
  TierTask,
  WorkspaceSettingsChange,
} from "@parfocal/api-client";

import type { TumorShareSettings } from "@parfocal/ui/lib/tumor-share";

export type DefaultKey = "default_privacy_mode" | "default_classes" | "default_study_template";

export type WorkspaceDefaults = {
  privacy: "de-identified" | "clinical";
  classes: "none" | "sentinel-node" | "pannuke";
  template: string;
};

export const privacyOptions = [
  { value: "de-identified", label: "De-identified" },
  { value: "clinical", label: "Clinical" },
] as const;

export const classOptions = [
  { value: "none", label: "No classes" },
  { value: "sentinel-node", label: "Sentinel node" },
  { value: "pannuke", label: "PanNuke" },
] as const;

export const NO_TEMPLATE = "";

export function defaultsOf(lab: LabSettings): WorkspaceDefaults {
  const {
    default_privacy_mode: privacy,
    default_classes: classes,
    default_study_template,
  } = lab.values;
  return {
    privacy: privacy === "clinical" ? "clinical" : "de-identified",
    classes: classes === "sentinel-node" || classes === "pannuke" ? classes : "none",
    template: typeof default_study_template === "string" ? default_study_template : NO_TEMPLATE,
  };
}

export function defaultChange(
  lab: LabSettings,
  key: DefaultKey,
  value: string | null,
): WorkspaceSettingsChange {
  return { values: { [key]: value === NO_TEMPLATE ? null : value }, locked: lab.locked };
}

export type TumorShareKey =
  | "tumor_share_cutoff"
  | "tumor_share_result_sentinel_node"
  | "tumor_share_result_pannuke";

export const cutoffChoices = [10, 20, 30, 40, 50];

export function tumorShareOf(lab: LabSettings): TumorShareSettings {
  const { tumor_share_cutoff: cutoff, tumor_share_result_sentinel_node: sentinel } = lab.values;
  const { tumor_share_result_pannuke: pannuke } = lab.values;
  return {
    tumor_share_cutoff: typeof cutoff === "number" ? cutoff : 20,
    tumor_share_result_sentinel_node: typeof sentinel === "boolean" ? sentinel : false,
    tumor_share_result_pannuke: typeof pannuke === "boolean" ? pannuke : true,
  };
}

export function tumorShareChange(
  lab: LabSettings,
  key: TumorShareKey,
  value: number | boolean,
): WorkspaceSettingsChange {
  return { values: { [key]: value }, locked: lab.locked };
}

export function durationText(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export const idleLockChoices = [5, 10, 15, 30, 60, 120, 240];
export const sessionHourChoices = [4, 8, 12, 24];
export const emergencyHourChoices = [1, 2, 4, 8];

export const withCurrent = (choices: number[], current: number): number[] =>
  choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);

export const taskText: Record<TierTask, string> = {
  tumor: "Tumor regions",
  outline: "Cell outlines",
  typer: "Cell types",
};

export const tierText: Record<ModelTier, string> = { best: "Best", good: "Good", fast: "Fast" };

export const tierTasks: TierTask[] = ["tumor", "outline", "typer"];

export const tierLevels: ModelTier[] = ["best", "good", "fast"];

const makesNeeded: Record<TierTask, string> = {
  tumor: "regions",
  outline: "cells",
  typer: "cells",
};

export const parfocalTierModels = [
  { name: "camelyon-tumor", title: "CAMELYON tumor model", makes: ["regions", "heatmap"] },
  { name: "pathosam-hovernext", title: "PathoSAM + HoVer-NeXt", makes: ["regions", "cells"] },
  { name: "hovernet", title: "HoVer-Net", makes: ["cells"] },
];

export const modelsForTask = (task: TierTask) =>
  parfocalTierModels.filter((model) => model.makes.includes(makesNeeded[task]));

export const NOT_CHOSEN = "default";

export function tierCell(mappings: TierMapping[], task: TierTask, tier: ModelTier) {
  const mapping = mappings.find((item) => item.task === task && item.tier === tier);
  return {
    value: mapping?.set_by_lab ? (mapping.model?.name ?? NOT_CHOSEN) : NOT_CHOSEN,
    shown: mapping?.model?.label ?? "No model, runs in the browser or not at all",
  };
}

export const announcementKinds: { value: AnnouncementKind; label: string }[] = [
  { value: "model", label: "New model" },
  { value: "slowdown", label: "Slowdown" },
  { value: "change", label: "Change" },
];

export const announcementEnds = [
  { value: "never", label: "Until I end it", hours: null },
  { value: "hour", label: "In 1 hour", hours: 1 },
  { value: "day", label: "In 1 day", hours: 24 },
  { value: "week", label: "In 7 days", hours: 168 },
] as const;

export type AnnouncementEnd = (typeof announcementEnds)[number]["value"];

export function endsAtFor(choice: AnnouncementEnd, from: Date): string | null {
  const hours = announcementEnds.find((item) => item.value === choice)?.hours ?? null;
  return hours === null ? null : new Date(from.getTime() + hours * 3_600_000).toISOString();
}

export const isAnnouncementText = (text: string) => text.trim().length > 0 && text.length <= 280;
