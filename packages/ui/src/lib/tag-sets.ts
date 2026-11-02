export const statusTones = ["neutral", "accent", "ok", "warn", "bad", "research"] as const;
export type StatusTone = (typeof statusTones)[number];

export const categoryTones = ["neutral", "info"] as const;
export type CategoryTone = (typeof categoryTones)[number];

export const resultSetSources = ["imported", "run", "reviewed"] as const;
export type ResultSetSource = (typeof resultSetSources)[number];

export const tagHeightsPx = {
  "status-tag": [20],
  "category-tag": [20],
  "object-id-tag": [20, 28],
  "result-set-tag": [20],
  "count-badge": [16],
  "filter-chip": [28],
} as const;

export type TagSlot = keyof typeof tagHeightsPx;

export const tagSlots = Object.keys(tagHeightsPx) as TagSlot[];

const tonesBySlot: Partial<Record<TagSlot, readonly string[]>> = {
  "status-tag": statusTones,
  "category-tag": categoryTones,
  "result-set-tag": resultSetSources,
};

export function isTagHeightInSet(slot: TagSlot, heightPx: number): boolean {
  return (tagHeightsPx[slot] as readonly number[]).includes(Math.round(heightPx));
}

export function isTagToneInSet(slot: TagSlot, tone: string | null): boolean {
  const allowed = tonesBySlot[slot];
  return allowed === undefined || allowed.includes(tone ?? "");
}
