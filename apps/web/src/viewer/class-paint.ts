import { type ClassName, classColors } from "@parfocal/viewer-engine";
import type { ClassPalette } from "../shell/display-defaults.ts";

type Rgba = readonly [number, number, number, number];

export type ClassPaint = {
  readonly name: string;
  readonly className: ClassName;
  readonly colour: Rgba;
  readonly hex: string;
};

export const fallbackPalette = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#bfef45",
  "#fabed4",
  "#469990",
  "#dcbeff",
  "#9a6324",
] as const;

export const safePalette = [
  "#e69f00",
  "#56b4e9",
  "#009e73",
  "#f0e442",
  "#0072b2",
  "#d55e00",
  "#cc79a7",
] as const;

const safeEngineSlots: Readonly<Record<ClassName, number>> = {
  tumor: 5,
  stroma: 1,
  immune: 6,
  other: 0,
};

const engineClasses = Object.keys(classColors) as ClassName[];

export const engineClassOf = (name: string): ClassName =>
  engineClasses.find((item) => item === name.toLowerCase()) ?? "other";

export function hexToRgba(hex: string): Rgba | null {
  const value = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    255,
  ];
}

const toHex = (colour: Rgba) =>
  `#${colour
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;

export function nameHash(name: string): number {
  let hash = 2166136261;
  for (const char of name.toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function fallbackColour(name: string): Rgba {
  const lower = name.toLowerCase();
  const engine = engineClasses.find((item) => item === lower);
  if (engine !== undefined) return classColors[engine];
  const hex = fallbackPalette[nameHash(lower) % fallbackPalette.length] ?? fallbackPalette[0];
  return hexToRgba(hex) ?? classColors.other;
}

type ProjectClassRow = { readonly id: string; readonly name: string; readonly colour: string };

type SetClassRow = {
  readonly position: number;
  readonly name: string;
  readonly class_id?: string | null;
};

export function safeColour(name: string, slot?: number): Rgba {
  const lower = name.toLowerCase();
  const engine = engineClasses.find((item) => item === lower);
  const index = engine === undefined ? (slot ?? nameHash(lower)) : safeEngineSlots[engine];
  return hexToRgba(safePalette[index % safePalette.length] ?? safePalette[0]) ?? classColors.other;
}

export function paintFor(
  name: string,
  projectClasses: readonly ProjectClassRow[],
  id?: string | null,
  palette: ClassPalette = "standard",
  slot?: number,
) {
  if (palette === "safe") {
    const colour = safeColour(name, slot);
    return { name, className: engineClassOf(name), colour, hex: toHex(colour) };
  }
  const lower = name.toLowerCase();
  const project =
    (id ? projectClasses.find((item) => item.id === id) : undefined) ??
    projectClasses.find((item) => item.name.toLowerCase() === lower);
  const colour = (project ? hexToRgba(project.colour) : null) ?? fallbackColour(name);
  return { name, className: engineClassOf(name), colour, hex: toHex(colour) };
}

export function classPaints(
  setClasses: readonly SetClassRow[],
  projectClasses: readonly ProjectClassRow[],
  palette: ClassPalette = "standard",
): ClassPaint[] {
  const paints: ClassPaint[] = [];
  for (const item of setClasses) {
    paints[item.position] = paintFor(
      item.name,
      projectClasses,
      item.class_id,
      palette,
      item.position,
    );
  }
  return paints;
}
