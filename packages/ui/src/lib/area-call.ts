export type AreaCall = "tumor" | "not" | "unsure";

export type AreaCount = "agree" | "disagree" | "unsure";

export type CallableArea = { id: string; call: AreaCall | null };

export type AreaRole = "sets" | "cannot" | "dropped";

export const areaCalls: readonly { call: AreaCall; label: string; key: string }[] = [
  { call: "tumor", label: "Tumor", key: "Enter" },
  { call: "not", label: "Not tumor", key: "X" },
  { call: "unsure", label: "Unsure", key: "U" },
];

const countOfCall: Record<AreaCall, AreaCount> = {
  tumor: "agree",
  not: "disagree",
  unsure: "unsure",
};

const callOfCount: Record<AreaCount, AreaCall> = {
  agree: "tumor",
  disagree: "not",
  unsure: "unsure",
};

export const countOf = (call: AreaCall): AreaCount => countOfCall[call];

export const callOf = (count: AreaCount | undefined): AreaCall | null =>
  count === undefined ? null : callOfCount[count];

export const pickCall = (current: AreaCall | null, picked: AreaCall): AreaCall | null =>
  current === picked ? null : picked;

export const leadAreaId = (areas: readonly CallableArea[]): string | null =>
  areas.find((area) => area.call !== "not")?.id ?? null;

export function areaRole(areas: readonly CallableArea[], id: string): AreaRole {
  const area = areas.find((item) => item.id === id);
  if (area?.call === "not") return "dropped";
  return leadAreaId(areas) === id ? "sets" : "cannot";
}

export const roleText: Record<AreaRole, string> = {
  sets: "Sets the category",
  cannot: "Can't change the category",
  dropped: "Dropped from the report",
};

export const isTicked = (call: AreaCall | null): boolean => call === "tumor" || call === "not";

export function areaProgress(areas: readonly CallableArea[]): { done: number; total: number } {
  return { done: areas.filter((area) => isTicked(area.call)).length, total: areas.length };
}

export const unsureAreaIds = (areas: readonly CallableArea[]): string[] =>
  areas.filter((area) => area.call === "unsure").map((area) => area.id);

export function callToast(
  areas: readonly CallableArea[],
  id: string,
  call: AreaCall | null,
): string {
  if (call === null) return `${id}: call removed.`;
  if (call === "tumor") return `${id}: tumor. It goes into the report as confirmed by you.`;
  if (call === "unsure") {
    return `${id}: not sure. It stays open until you decide, and the researcher sees it.`;
  }
  const next = leadAreaId(areas.map((area) => (area.id === id ? { ...area, call } : area)));
  const handsOver = leadAreaId(areas) === id && next !== null && next !== id;
  return `${id}: not tumor. It is dropped from the report${handsOver ? `, and ${next} now sets the category` : ""}.`;
}
