const avatarColours = [
  "#2563eb",
  "#6d28d9",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#64748b",
  "#be185d",
  "#0369a1",
  "#0891b2",
];

const projectColours = ["#f87171", "#fbbf24", "#c084fc", "#6ee7b7", "#38bdf8"];

const pick = (colours: string[], index: number) =>
  colours[((index % colours.length) + colours.length) % colours.length] ?? "#64748b";

export const avatarColour = (index: number) => pick(avatarColours, index);

export const projectColour = (index: number) => pick(projectColours, index);
