import type { AnnotationLayer } from "../draft/list-annotation-layers.ts";
import type { ModelTier } from "../draft/list-model-tiers.ts";

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

export const modelTiers: ModelTier[] = [
  {
    job: "tumor",
    tier: "Best",
    model: "CAMELYON16 tumor model · MONAI Label · v1.0",
    description: "The tumor model your lab validated.",
    speed: 1,
    runs_on: "server",
  },
  {
    job: "outline",
    tier: "Best",
    model: "PathoSAM ViT-B · AIS decoder · v1.2",
    description: "The most accurate outlines. Slowest, runs on the hospital server.",
    speed: 1,
    runs_on: "server",
  },
  {
    job: "outline",
    tier: "Good",
    model: "HoVer-Net · MONAI Label · v0.9",
    description: "Nearly as accurate, about three times quicker.",
    speed: 2,
    runs_on: "server",
  },
  {
    job: "outline",
    tier: "Fast",
    model: "SlimSAM-77 · ONNX in the browser · v1.0",
    description: "A quick draft that runs on this computer, also offline.",
    speed: 3,
    runs_on: "browser",
  },
  {
    job: "typer",
    tier: "Best",
    model: "HoVer-NeXt · PanNuke types · v1.1",
    description: "Types every nucleus on the hospital server.",
    speed: 1,
    runs_on: "server",
  },
  {
    job: "typer",
    tier: "Good",
    model: "MONAI classifier · round 3",
    description: "A lighter classifier trained on your lab's corrections.",
    speed: 2,
    runs_on: "server",
  },
  {
    job: "typer",
    tier: "Fast",
    model: "Learned in your browser · 212 examples",
    description: "Learns from your own examples on this computer.",
    speed: 3,
    runs_on: "browser",
  },
];
