import { t } from "@lingui/core/macro";
import {
  getDownloadDatasetVersionUrl,
  getDownloadPatchExportUrl,
  getExportTrainingDatasetUrl,
  startPatchExport,
} from "@parfocal/api-client";
import { saveResponse } from "./slide-export.ts";

export type TaskExportKind = "training-dataset" | "patches";

export type TaskExportChoice = {
  readonly kind: TaskExportKind;
  readonly label: string;
  readonly line: string;
};

export const smallestTile = 64;
export const largestTile = 2048;
export const defaultTile = 512;
export const deepestLevel = 16;

export function taskExportChoices(): TaskExportChoice[] {
  return [
    {
      kind: "training-dataset",
      label: t`Training dataset (QuPath GeoJSON zip)`,
      line: t`One GeoJSON file per signed off slide with each object's class, origin and author letters, and a manifest`,
    },
    {
      kind: "patches",
      label: t`Patches with masks`,
      line: t`Image tiles of the signed off slides with a class mask for each tile and an index, cut as a job`,
    },
  ];
}

export function refusalText(code: string | null): string {
  if (code === "nothing-signed-off") {
    return t`No slide of this task is signed off yet. Sign off at least one slide, then export again. Only signed off slides go into the training data.`;
  }
  if (code === "dataset-hidden") {
    return t`Only people who see the whole task can export its training data.`;
  }
  if (code === "not-an-annotate-task") {
    return t`Only annotate tasks make a training dataset. A review task measures the model instead.`;
  }
  if (code === "nothing-chosen") {
    return t`These filters leave no object. Choose more slides, classes or origins, then freeze again.`;
  }
  if (code === "dataset-version-changed") {
    return t`The stored version no longer matches its checksum, so it was not sent.`;
  }
  return t`The export could not be made`;
}

export type TaskExportResult =
  | { readonly state: "saved"; readonly name: string }
  | { readonly state: "refused"; readonly code: string | null };

async function problemCodeOf(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

export async function downloadTrainingDataset(taskId: string): Promise<TaskExportResult> {
  const response = await fetch(getExportTrainingDatasetUrl(taskId), {
    credentials: "same-origin",
  });
  if (!response.ok) return { state: "refused", code: await problemCodeOf(response) };
  return { state: "saved", name: await saveResponse(response, "parfocal-dataset.zip") };
}

export type PatchStart =
  | { readonly state: "started"; readonly jobId: string }
  | { readonly state: "refused"; readonly code: string | null };

export async function startPatches(
  taskId: string,
  level: number,
  tileSize: number,
  datasetVersion: number | null = null,
): Promise<PatchStart> {
  try {
    const started = await startPatchExport(taskId, {
      level,
      tile_size: tileSize,
      ...(datasetVersion === null ? {} : { dataset_version: datasetVersion }),
    });
    if (started.status === 202) return { state: "started", jobId: started.data.job_id };
    return { state: "refused", code: null };
  } catch (error) {
    const code = (error as { problem?: { code?: string } }).problem?.code;
    return { state: "refused", code: code ?? null };
  }
}

export async function downloadDatasetVersion(
  taskId: string,
  version: number,
): Promise<TaskExportResult> {
  const response = await fetch(getDownloadDatasetVersionUrl(taskId, version), {
    credentials: "same-origin",
  });
  if (!response.ok) return { state: "refused", code: await problemCodeOf(response) };
  return {
    state: "saved",
    name: await saveResponse(response, `parfocal-dataset-v${version}.zip`),
  };
}

export type PatchPoll =
  | { readonly state: "cutting" }
  | { readonly state: "saved"; readonly name: string }
  | { readonly state: "failed" };

export async function pollPatches(taskId: string, jobId: string): Promise<PatchPoll> {
  const response = await fetch(getDownloadPatchExportUrl(taskId, jobId), {
    credentials: "same-origin",
  });
  if (response.ok) {
    return { state: "saved", name: await saveResponse(response, "parfocal-patches.zip") };
  }
  const code = await problemCodeOf(response);
  return code === "patch-export-not-ready" ? { state: "cutting" } : { state: "failed" };
}
