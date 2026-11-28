import type {
  ModelOutput,
  ModelReference,
  ModelRunDraft,
  ProjectModel,
} from "@parfocal/api-client";
import type { Blocker } from "@parfocal/ui/components/before-you-list";
import { runBlockers, servedModels } from "./run-model-parts.ts";

export type OutputPicks = { tumor: boolean; outlines: boolean; types: boolean };

export type OutputChoice = keyof OutputPicks;

export function outputsOf(model: ProjectModel): ModelOutput[] {
  if (model.outputs?.length) return model.outputs.map((item) => item.output);
  return [
    ...(model.makes.includes("regions") || model.makes.includes("heatmap")
      ? (["tumor-regions"] as const)
      : []),
    ...(model.makes.includes("cells") ? (["cell-outlines"] as const) : []),
  ];
}

const making = (models: ProjectModel[], output: ModelOutput) =>
  servedModels(models).filter((model) => outputsOf(model).includes(output));

export const tumorModels = (models: ProjectModel[]) => making(models, "tumor-regions");

export const cellModels = (models: ProjectModel[]) => making(models, "cell-outlines");

export const typesCells = (model: ProjectModel | undefined) =>
  model !== undefined && outputsOf(model).includes("cell-types");

export function startingPicks(model: ProjectModel | undefined): OutputPicks {
  if (model === undefined) return { tumor: false, outlines: true, types: true };
  const outputs = outputsOf(model);
  return {
    tumor: outputs.includes("tumor-regions"),
    outlines: outputs.includes("cell-outlines"),
    types: outputs.includes("cell-types"),
  };
}

export function startingFor(
  candidates: ProjectModel[],
  initial: ProjectModel | undefined,
): string | null {
  const chosen = candidates.find((model) => model.id === initial?.id) ?? candidates[0];
  return chosen?.id ?? null;
}

export function toggled(picks: OutputPicks, choice: OutputChoice, on: boolean): OutputPicks {
  if (choice === "types") return { ...picks, types: on, outlines: on || picks.outlines };
  if (choice === "outlines") return { ...picks, outlines: on, types: on && picks.types };
  return { ...picks, tumor: on };
}

export function evidenceText(model: ProjectModel | undefined, output: ModelOutput): string {
  const found = model?.outputs?.find((item) => item.output === output);
  if (!found?.measured) return "Not measured";
  return found.data
    ? `Measured: ${found.measured}. On ${found.data}.`
    : `Measured: ${found.measured}.`;
}

const reference = (model: ProjectModel): ModelReference => ({
  name: model.name,
  version: model.version,
});

export type PlannedRun = { model: ProjectModel; what: string; draft: ModelRunDraft };

export function plannedRuns(
  slideIds: string[],
  picks: OutputPicks,
  tumor: ProjectModel | undefined,
  cells: ProjectModel | undefined,
): PlannedRun[] {
  const draft = (parameters: ModelRunDraft["parameters"]): ModelRunDraft => ({
    slide_ids: slideIds,
    scope: { kind: "slide" },
    parameters,
  });
  const typed = picks.types && typesCells(cells);
  return [
    ...(picks.tumor && tumor
      ? [{ model: tumor, what: "Tumor regions", draft: draft({ detector: reference(tumor) }) }]
      : []),
    ...(picks.outlines && cells
      ? [
          {
            model: cells,
            what: typed ? "Cell outlines and types" : "Cell outlines",
            draft: draft({
              detector: reference(cells),
              typer: typed ? reference(cells) : null,
            }),
          },
        ]
      : []),
  ];
}

export function outputBlockers(
  pickedCount: number,
  picks: OutputPicks,
  tumor: ProjectModel | undefined,
  cells: ProjectModel | undefined,
): Blocker[] {
  if (!picks.tumor && !picks.outlines) {
    return [
      ...runBlockers(pickedCount, cells ?? tumor).filter((item) => item.id === "slides"),
      { id: "outputs", text: "Pick what to make.", goTo: "What to make" },
    ];
  }
  const chosen = [...(picks.tumor ? [tumor] : []), ...(picks.outlines ? [cells] : [])];
  const seen = new Set<string>();
  return chosen
    .flatMap((model) => runBlockers(pickedCount, model))
    .filter((item) => {
      const key = typeof item.text === "string" ? `${item.id}:${item.text}` : item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item, index) => ({
      ...item,
      id: `${item.id}-${index}`,
      goTo: item.goTo === "Model" ? "What to make" : item.goTo,
    }));
}
