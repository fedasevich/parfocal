export type WorklistTone = "neutral" | "accent" | "ok" | "warn";

export type WorklistRow = {
  id: string;
  slide: string;
  project: string;
  caseLabel: string;
  resultSets: number;
  reviewer: { initials: string; name: string; color: string };
  reviewState: string;
  status: { word: string; tone: WorklistTone };
  due: string;
};

const projects = ["BRCA-24", "LUAD-07", "CRC-12", "SLN-03", "PROS-19"];
const reviewers = [
  { initials: "AK", name: "Anna Kowalska", color: "#7c6cf0" },
  { initials: "JN", name: "Jan Novak", color: "#2f9e8f" },
  { initials: "MS", name: "Marta Svoboda", color: "#d9822b" },
  { initials: "PL", name: "Petr Lukas", color: "#3b82c4" },
];
const reviewStates = ["assigned", "in review", "submitted"];
const statuses: WorklistRow["status"][] = [
  { word: "ready", tone: "neutral" },
  { word: "in review", tone: "accent" },
  { word: "signed", tone: "ok" },
  { word: "needs results", tone: "warn" },
];

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)] as T;
}

export function worklistRows(count: number, seed = 7): WorklistRow[] {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, index) => {
    const day = 1 + Math.floor(random() * 28);
    return {
      id: `slide-${index}`,
      slide: `S-${String(10000 + index).padStart(5, "0")}`,
      project: pick(projects, random),
      caseLabel: `case ${100 + Math.floor(random() * 900)}`,
      resultSets: Math.floor(random() * 4),
      reviewer: pick(reviewers, random),
      reviewState: pick(reviewStates, random),
      status: pick(statuses, random),
      due: `${day} Nov`,
    };
  });
}

const moves: Record<string, (index: number, count: number) => number> = {
  j: (index) => index + 1,
  ArrowDown: (index) => index + 1,
  k: (index) => index - 1,
  ArrowUp: (index) => index - 1,
  Home: () => 0,
  End: (_, count) => count - 1,
};

export function movedIndex(index: number, key: string, count: number): number | undefined {
  const move = moves[key];
  if (!move || count === 0) return undefined;
  return Math.min(count - 1, Math.max(0, move(index, count)));
}
