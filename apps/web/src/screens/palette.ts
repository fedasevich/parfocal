const projectColours = ["#f87171", "#fbbf24", "#c084fc", "#6ee7b7", "#38bdf8"];

const pick = (colours: string[], index: number) =>
  colours[((index % colours.length) + colours.length) % colours.length] ?? "#64748b";

export const projectColour = (index: number) => pick(projectColours, index);
