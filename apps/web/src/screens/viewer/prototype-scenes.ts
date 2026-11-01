import { linkOptions } from "@tanstack/react-router";
import type { SceneOf } from "../scenes.ts";
import { findingsObjects } from "./viewer-scenes.ts";

const caseScenes: { scene: SceneOf<"case">; label: string; note: string }[] = [
  { scene: "objects", label: "Objects tab", note: "A1 at low power, every object in the list" },
  { scene: "open", label: "Objects tab, filtered to open", note: "Only the open objects" },
  { scene: "grid", label: "Cells panel open", note: "T2·C204 with the floating cells panel" },
  { scene: "running", label: "AI still running", note: "Two regions found so far" },
  {
    scene: "loading",
    label: "Tiles loading",
    note: "The coarse level first, sharper tiles fade in",
  },
  { scene: "unloaded", label: "Not loaded yet", note: "A quiet checker where nothing has loaded" },
  { scene: "submitfail", label: "Issue · submit failed", note: "Try again in the Opinion tab" },
  { scene: "connlost", label: "Issue · connection lost", note: "The answer buttons wait" },
  {
    scene: "slidefail",
    label: "Issue · slide fails to load",
    note: "Tiles missing at 20x and 40x",
  },
  { scene: "noresults", label: "Issue · no results", note: "tumor_052 has nothing to decide" },
  { scene: "withdrawn", label: "Issue · the task was withdrawn", note: "Back to My work" },
  { scene: "signedoff", label: "Read-only after sign-off", note: "Changes need an amendment" },
  { scene: "slow", label: "Issue · slow source", note: "The hint names the scanner archive" },
  { scene: "remoteoff", label: "Issue · remote source offline", note: "Opens from the tile cache" },
];

const findingsScenes: { scene: SceneOf<"findings">; label: string; note: string }[] = [
  { scene: "open", label: "An open region, T5", note: "The question in the panel foot" },
  { scene: "decided", label: "A decided region with a note, T2", note: "Disagree with its note" },
  { scene: "added", label: "Your added region, T6⁺", note: "Outside the scope, counted apart" },
];

const layersScenes: { scene: SceneOf<"layers">; label: string; note: string }[] = [
  { scene: "panel", label: "Objects on the slide", note: "The Display tab with the View zone" },
  { scene: "heat", label: "Heatmap", note: "Tumor probability from 0.60" },
  { scene: "density", label: "Cell density", note: "Cells per 0.1 mm²" },
  { scene: "diff", label: "AI vs reviewed", note: "Agree, AI only and reviewer only" },
  { scene: "models", label: "Model vs model", note: "CAMELYON against PathoSAM" },
  { scene: "readers", label: "Reviewer vs reviewer", note: "Lenka and Simona, kappa 0.71" },
  { scene: "swipe", label: "Swipe between two sets", note: "A on the left, B on the right" },
  { scene: "table", label: "Object table and stats", note: "T2 picked, scores and classes" },
  { scene: "display", label: "Display panel, the task default", note: "Every zone open" },
  { scene: "locked", label: "Display, a setting locked by the task", note: "Confidence hidden" },
  { scene: "preset", label: "Display, a preset switched", note: "Dots, no IDs with the menu open" },
];

export function viewerPrototypeLinks(
  projectId: string,
  taskId: string,
  slideId: string,
  emptySlideId: string | undefined,
  clinical: { projectId: string; slideId: string } | undefined,
) {
  const params = { projectId, slideId };
  return [
    ...caseScenes.map(({ scene, label, note }) => ({
      key: `case-${scene}`,
      label: `Full viewer · ${label}`,
      note,
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params: { projectId, slideId: scene === "noresults" ? (emptySlideId ?? slideId) : slideId },
        search: { task: taskId, scene },
      }),
    })),
    ...findingsScenes.map(({ scene, label, note }) => ({
      key: `findings-${scene}`,
      label: `Full viewer, one object · ${label}`,
      note,
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, object: findingsObjects[scene] },
      }),
    })),
    ...layersScenes.map(({ scene, label, note }) => ({
      key: `layers-${scene}`,
      label: `Visualize · ${label}`,
      note,
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, scene },
      }),
    })),
    {
      key: "layers-save-preset",
      label: "Visualize · Save a preset",
      note: "The small modal from Save as",
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, scene: "display", modal: "preset" },
      }),
    },
    ...(clinical
      ? [
          {
            key: "case-clinical",
            label: "Full viewer · a clinical case",
            note: "Open report takes the place of Submit",
            link: linkOptions({
              to: "/projects/$projectId/slides/$slideId",
              params: clinical,
              search: { scene: "objects" },
            }),
          },
        ]
      : []),
  ];
}
