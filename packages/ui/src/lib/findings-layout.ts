import { type CellCount, needsCount } from "./ai-state.ts";
import { type AreaCall, areaCalls, isTicked } from "./area-call.ts";
import type { InspectorTemplate } from "./inspector-tabs.ts";

export type FindingsLayout = "cell-findings" | "node-staging";

export const findingsLayoutFor = (template: InspectorTemplate): FindingsLayout =>
  template === "sentinel-node" ? "node-staging" : "cell-findings";

export const CHANGED_ZONE_ID = "changed";

export const CHANGED_ZONE_NAME = "Changed after your corrections";

export type FindingsZone = {
  id: string;
  name: string;
  cells: number;
  unsure: number;
  open: number;
};

export type FindingsSelection =
  | { kind: "none" }
  | { kind: "zone"; id: string }
  | { kind: "cell"; id: string; zoneId: string | null }
  | { kind: "outline"; id: string };

export const nothingSelected: FindingsSelection = { kind: "none" };

export type FindingsSection =
  | "warnings"
  | "back"
  | "number-line"
  | "zones"
  | "scattered"
  | "outline"
  | "changed"
  | "gallery"
  | "cell"
  | "siblings"
  | "extras";

export type FindingsContent = {
  warnings: number;
  zones: number;
  scattered: number;
  outline: boolean;
  changed: number;
  extras: number;
};

export function findingsSections(
  selection: FindingsSelection,
  content: FindingsContent,
): FindingsSection[] {
  const top: FindingsSection[] = content.warnings > 0 ? ["warnings"] : [];
  if (selection.kind === "zone") return [...top, "back", "number-line", "gallery"];
  if (selection.kind === "outline") return [...top, "back", "number-line"];
  if (selection.kind === "cell") {
    return [...top, "back", "cell", ...(selection.zoneId === null ? [] : ["siblings" as const])];
  }
  return [
    ...top,
    "number-line",
    ...(content.zones > 0 ? ["zones" as const] : []),
    ...(content.scattered > 0 ? ["scattered" as const] : []),
    ...(content.outline ? ["outline" as const] : []),
    ...(content.changed > 0 ? ["changed" as const] : []),
    ...(content.extras > 0 ? ["extras" as const] : []),
  ];
}

export const unsureShare = (zone: FindingsZone) => (zone.cells > 0 ? zone.unsure / zone.cells : 0);

export function zonesMostUnsureFirst<Zone extends FindingsZone>(zones: readonly Zone[]): Zone[] {
  return zones
    .map((zone, index) => ({ zone, index }))
    .sort(
      (a, b) =>
        unsureShare(b.zone) - unsureShare(a.zone) ||
        b.zone.unsure - a.zone.unsure ||
        a.index - b.index,
    )
    .map(({ zone }) => zone);
}

const cellWord = (count: number) => `${count} ${count === 1 ? "cell" : "cells"}`;

export function zoneNumbers(zone: FindingsZone): string {
  const share = Math.round(unsureShare(zone) * 100);
  return `${zone.unsure} unsure of ${cellWord(zone.cells)} (${share}%), ${zone.open} open`;
}

export function stepBack(selection: FindingsSelection): FindingsSelection {
  if (selection.kind === "cell" && selection.zoneId !== null) {
    return { kind: "zone", id: selection.zoneId };
  }
  return nothingSelected;
}

export function backLabel(selection: FindingsSelection, zoneName?: string): string {
  const target = stepBack(selection);
  return target.kind === "zone" ? `Back to ${zoneName ?? "the zone"}` : "Back to the list";
}

export type StagingPanelArea = {
  id: string;
  size: number;
  low: number;
  high: number;
  call: AreaCall | null;
  measured?: number | null;
  cells?: CellCount | null;
  counted?: number | null;
};

export type StagingStepName = "tumor" | "size" | "count";

export type StagingStep = {
  name: StagingStepName;
  index: number;
  title: string;
  done: boolean;
  answer?: string;
};

const stepTitle: Record<StagingStepName, string> = {
  tumor: "Is it tumor?",
  size: "How big is it?",
  count: "How many tumor cells?",
};

export const formatAreaMm = (mm: number) => `${mm.toFixed(mm < 1 ? 2 : 1)} mm`;

export const asksCellCount = (area: StagingPanelArea) =>
  needsCount({ object: area.id, size: area.size, measured: area.measured ?? null });

export function stagingSteps(area: StagingPanelArea): StagingStep[] {
  const callLabel = areaCalls.find((item) => item.call === area.call)?.label;
  const steps: Omit<StagingStep, "index" | "title">[] = [
    {
      name: "tumor",
      done: isTicked(area.call),
      ...(callLabel ? { answer: callLabel } : {}),
    },
    {
      name: "size",
      done: area.measured != null,
      ...(area.measured != null ? { answer: formatAreaMm(area.measured) } : {}),
    },
    ...(asksCellCount(area)
      ? [
          {
            name: "count" as const,
            done: area.counted != null,
            ...(area.counted != null ? { answer: `${area.counted} tumor cells` } : {}),
          },
        ]
      : []),
  ];
  const asked = area.call === "not" ? steps.slice(0, 1) : steps;
  return asked.map((step, position) => ({
    ...step,
    index: position + 1,
    title: stepTitle[step.name],
  }));
}

export const nextStagingStep = (area: StagingPanelArea): StagingStepName | null =>
  stagingSteps(area).find((step) => !step.done)?.name ?? null;
