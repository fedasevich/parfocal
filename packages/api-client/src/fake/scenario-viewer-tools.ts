import type { AnnotationLayer } from "../draft/list-annotation-layers.ts";
import type { ModelTier, TierMapping, TierModel, TierTask } from "../generated/api.ts";

export const layersOnA1: AnnotationLayer[] = [
  {
    key: "area2-tumor",
    name: "Area 2 tumor nuclei",
    class_name: "Tumor",
    count: 412,
    parent: null,
    locked: true,
  },
  {
    key: "area2-reviewed",
    name: "Reviewed",
    class_name: "Tumor",
    count: 48,
    parent: "area2-tumor",
    locked: false,
  },
  {
    key: "area2-job",
    name: "From whole-slide job",
    class_name: "Tumor",
    count: 364,
    parent: "area2-tumor",
    locked: false,
  },
  { key: "immune", name: "Immune", class_name: "Immune", count: 465, parent: null, locked: false },
  { key: "stroma", name: "Stroma", class_name: "Stroma", count: 32, parent: null, locked: false },
  {
    key: "measurements",
    name: "Measurements",
    class_name: null,
    count: 3,
    parent: null,
    locked: false,
  },
];

const tierModel = (name: string, title: string, version: string, description: string) => ({
  name,
  version,
  title,
  description,
  label: `${title} · ${version}`,
});

const camelyon = tierModel(
  "camelyon-tumor",
  "CAMELYON tumor model",
  "v1.0",
  "Tumor regions and a heatmap",
);
const pathosam = tierModel(
  "pathosam-hovernext",
  "PathoSAM + HoVer-NeXt",
  "v1.2",
  "Tumor regions and every cell with a type",
);
const hovernet = tierModel("hovernet", "HoVer-Net", "v0.9", "Every cell with a type, no regions");

const mapped = (task: TierTask, tier: ModelTier, model: TierModel | null): TierMapping => ({
  task,
  tier,
  model,
  set_by_lab: false,
});

export const modelTiers: TierMapping[] = [
  mapped("tumor", "best", camelyon),
  mapped("tumor", "good", null),
  mapped("tumor", "fast", null),
  mapped("outline", "best", pathosam),
  mapped("outline", "good", hovernet),
  mapped("outline", "fast", null),
  mapped("typer", "best", pathosam),
  mapped("typer", "good", hovernet),
  mapped("typer", "fast", null),
];
