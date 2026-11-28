import type { OutputEvidence } from "../generated/api.ts";

const tumor: OutputEvidence = {
  output: "tumor-regions",
  measured: "FROC 0.722 and Dice 0.899 at 0.5",
  data: "Three annotated CAMELYON16 test slides and one normal slide",
  result: "docs/results/2026-11-16-tumor-map-evaluation-on-three-test-slides.md",
};

const outlines: OutputEvidence = {
  output: "cell-outlines",
  measured:
    "Matches the PyTorch reference on 97.5% of 366 nuclei, about 150 s per mm² of tissue on one L4. Not yet compared with hand outlines",
  data: "CMU-1-Small-Region for the match, CAMELYON16 test_001 for the time",
  result: "docs/results/2026-11-16-nucleus-job-throughput-on-l4.md",
};

const types: OutputEvidence = {
  output: "cell-types",
  measured: "83.0% of nuclei typed right, calibration error 0.022",
  data: "PanNuke test split, 12,928 nuclei from 18 tissue sites, lung left out",
  result: "docs/results/2026-11-04-typer-calibration-registry.md",
};

const notMeasured = (output: OutputEvidence["output"]): OutputEvidence => ({
  output,
  measured: null,
  data: null,
  result: null,
});

const outputs: Record<string, OutputEvidence[]> = {
  "camelyon-tumor": [tumor],
  "pathosam-hovernext": [outlines, types],
  hovernet: [notMeasured("cell-outlines"), notMeasured("cell-types")],
};

export const fakeOutputsOf = (name: string): OutputEvidence[] => outputs[name] ?? [];
