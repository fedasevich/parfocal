import type { TaskDisplaySettings } from "../generated/api.ts";

const defaults = {
  draw_as: "outline",
  width: 2,
  opacity: 100,
  colour_by: "class",
  id_labels: true,
  confidence: "number",
  heatmap: 0,
  score_cutoff: 0.4,
  other_sets: { reviewed_layer: true, result_set_ids: [] },
  order: "ai",
  zoom: "fit",
  move_on: true,
  buttons: "card",
} as const satisfies TaskDisplaySettings["defaults"];

const locks: Record<string, TaskDisplaySettings["locks"]> = {
  "RT-14": { order: "Everyone sees the objects in the same order, so agreement is fair" },
};

export const taskDisplayFor = (code: string): TaskDisplaySettings => ({
  defaults: { ...defaults, other_sets: { reviewed_layer: true, result_set_ids: [] } },
  locks: locks[code] ?? {},
});
