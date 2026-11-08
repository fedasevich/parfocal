import type { MapPoint } from "@parfocal/ui/components/smart-minimap";
import type { MinimapMode } from "@parfocal/ui/lib/minimap-machine";
import { seenPercent } from "./tool-geometry.ts";

export type MinimapCell = { point: MapPoint; decided: boolean };

export type MinimapTravel = { label: string; mm: number; from: MapPoint; to: MapPoint };

export type MinimapContentInput = {
  mode: Exclude<MinimapMode, "hidden">;
  areaCount: number;
  decidedCount: number;
  position: number;
  magnification: number;
  cells: MinimapCell[];
  travel: MinimapTravel | null;
};

export type MinimapDots = { points: MapPoint[]; done: number; current: number | undefined };

export type MinimapLayer = "trail" | "areas" | "outline" | "dots" | "route" | "viewport";

export type MinimapContent = {
  layers: MinimapLayer[];
  title: { strong: string; rest: string };
  foot: string;
  footEnd: string;
  dots: MinimapDots | null;
  route: { from: MapPoint; to: MapPoint } | null;
};

export function minimapContent(input: MinimapContentInput): MinimapContent {
  const { mode, areaCount, decidedCount, position, travel } = input;
  if (mode === "reading" || mode === "travel") {
    const route = mode === "travel" && travel ? { from: travel.from, to: travel.to } : null;
    return {
      layers: route ? ["trail", "areas", "route", "viewport"] : ["trail", "areas", "viewport"],
      title:
        route && travel
          ? { strong: `Going to ${travel.label}`, rest: ` · ${travel.mm.toFixed(1)} mm` }
          : { strong: "Whole slide", rest: ` · ${seenPercent.reading}% seen` },
      foot: route ? "Press ] again to skip" : `${position} of ${areaCount}`,
      footEnd: route
        ? ""
        : `${Math.round(input.magnification)}× · ${decidedCount} of ${areaCount} decided`,
      dots: null,
      route,
    };
  }
  const ordered = [...input.cells].sort((a, b) => Number(b.decided) - Number(a.decided));
  const done = ordered.filter((cell) => cell.decided).length;
  return {
    layers: mode === "locator" ? ["outline", "dots"] : ["outline", "dots", "viewport"],
    title: { strong: "", rest: "" },
    foot: `Area ${position}`,
    footEnd: ordered.length ? `${done} of ${ordered.length} checked` : "",
    dots: {
      points: ordered.map((cell) => cell.point),
      done,
      current: done < ordered.length ? done : undefined,
    },
    route: null,
  };
}
