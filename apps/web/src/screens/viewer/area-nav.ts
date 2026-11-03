import {
  type StagingArea,
  type StagingCategory,
  stagingCategory,
} from "@parfocal/ui/lib/analysis-parts";
import { actionOf } from "../../keys/actions.ts";
import type { CameraSearch } from "../review/camera-search.ts";
import type { Count } from "../review/decision-mapping.ts";
import { neighbourTargets } from "../viewer-tools/edge-cues.ts";

export const visitMagnification = 10;

export type AreaRole = "lead" | "fixed";

export type AreaRow = StagingArea & {
  number: number;
  category: StagingCategory;
  role: AreaRole | null;
  visited: boolean;
};

export const areaRoleText: Record<AreaRole, string> = {
  lead: "Largest, sets the category",
  fixed: "Can't change the category",
};

export function areaRows(
  areas: readonly StagingArea[],
  decisionOf: (object: string) => Count | undefined,
  visited: ReadonlySet<string> = new Set(),
): AreaRow[] {
  const ranked = [...areas].sort(
    (a, b) => b.size - a.size || a.object.localeCompare(b.object, "en"),
  );
  const leadAt = ranked.findIndex((area) => decisionOf(area.object) !== "disagree");
  const lead = ranked[leadAt];
  const settled = lead !== undefined && decisionOf(lead.object) === "agree";
  return ranked.map((area, index) => ({
    ...area,
    number: index + 1,
    category: stagingCategory(area.size),
    role:
      index === leadAt
        ? "lead"
        : settled && index > leadAt && decisionOf(area.object) !== "disagree"
          ? "fixed"
          : null,
    visited: visited.has(area.object),
  }));
}

export const areaOrder = (rows: readonly { object: string }[]) => rows.map((row) => row.object);

export function areaNumbered(order: readonly string[], number: number): string | null {
  return order[number - 1] ?? null;
}

export function stepArea(
  order: readonly string[],
  current: string | null | undefined,
  direction: "back" | "next",
): string | null {
  if (current === null || current === undefined || !order.includes(current))
    return (direction === "next" ? order[0] : order.at(-1)) ?? null;
  const picked = neighbourTargets([...order], current, () => [0, 0]).find(
    (target) => target.direction === direction,
  );
  return picked?.object ?? null;
}

export const visits = (magnification: number) => magnification >= visitMagnification;

export function markVisited(
  visited: ReadonlySet<string>,
  object: string | null | undefined,
  order: readonly string[],
  magnification: number,
): ReadonlySet<string> {
  if (!object || !order.includes(object) || !visits(magnification) || visited.has(object))
    return visited;
  return new Set([...visited, object]);
}

export type Spot = CameraSearch & { object: string | null };

export const sameSpot = (a: Spot, b: Spot) =>
  a.object === b.object && a.x === b.x && a.y === b.y && a.z === b.z;

export type AreaKey = { kind: "area"; object: string } | { kind: "back" } | { kind: "forward" };

export function areaKey(
  fired: { action: string; phase: string },
  order: readonly string[],
  current: string | null | undefined,
): AreaKey | null {
  if (fired.phase !== "press") return null;
  const { id, suffix } = actionOf(fired.action);
  if (id === "viewback") return { kind: "back" };
  if (id === "viewforward") return { kind: "forward" };
  const object =
    id === "area"
      ? areaNumbered(order, Number(suffix))
      : id === "prevarea"
        ? stepArea(order, current, "back")
        : id === "nextarea"
          ? stepArea(order, current, "next")
          : null;
  return object === null ? null : { kind: "area", object };
}

export const areaKeyIds = ["area", "prevarea", "nextarea", "viewback", "viewforward"] as const;
