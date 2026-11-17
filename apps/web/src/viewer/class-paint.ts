import { type ClassName, classColors } from "@parfocal/viewer-engine";

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

export function paintFor(
  name: string,
  projectClasses: readonly ProjectClassRow[],
  id?: string | null,
) {
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
): ClassPaint[] {
  const paints: ClassPaint[] = [];
  for (const item of setClasses) {
    paints[item.position] = paintFor(item.name, projectClasses, item.class_id);
  }
  return paints;
}
