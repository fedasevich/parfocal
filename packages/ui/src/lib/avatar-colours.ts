export const avatarColours = [
  "#2563eb",
  "#6d28d9",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#64748b",
  "#be185d",
  "#0369a1",
  "#0891b2",
] as const;

export function avatarColour(index: number): string {
  const count = avatarColours.length;
  return avatarColours[((Math.trunc(index) % count) + count) % count] ?? avatarColours[0];
}
