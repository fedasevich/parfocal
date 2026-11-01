import { linkOptions } from "@tanstack/react-router";
import type { SceneOf } from "../scenes.ts";

export const navigatorScenes: { scene: SceneOf<"navigator">; label: string; note: string }[] = [
  {
    scene: "overview",
    label: "Whole slide on screen",
    note: "No minimap, the seen tissue and checked areas are on the slide",
  },
  { scene: "reading", label: "Reading at 10x", note: "The map takes the corner nothing is under" },
  { scene: "avoid", label: "Measuring in its corner", note: "It moves away from the ruler" },
  { scene: "travel", label: "Going to the next area", note: "Bigger, with the route to area 3" },
  { scene: "cells", label: "Checking cells at 40x", note: "It maps area 2, dots are cells" },
  { scene: "focus", label: "One-cell focus", note: "A 92 px locator" },
  { scene: "pointer", label: "Pointer comes close", note: "It fades, a click still opens" },
];

export const annotateScenes: { scene: SceneOf<"annotate">; label: string; note: string }[] = [
  { scene: "auto", label: "Auto region", note: "46 proposals in area 2, Accept or Discard" },
  { scene: "models", label: "Choosing a model", note: "Best, Good and Fast for outlining nuclei" },
];

export const compareScenes: { scene: SceneOf<"compare">; label: string; note: string }[] = [
  {
    scene: "picked",
    label: "Slides picked",
    note: "A1 H&E on the left, the CK slide on the right",
  },
  { scene: "picking", label: "Picking the right side", note: "The right pane's slide list open" },
];

export function toolPrototypeLinks(projectId: string, taskId: string, slideId: string) {
  const params = { projectId, slideId };
  return [
    ...navigatorScenes.map(({ scene, label, note }) => ({
      key: `navigator-${scene}`,
      label: `Smart minimap · ${label}`,
      note,
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, scene },
      }),
    })),
    {
      key: "measure",
      label: "Measuring",
      note: "The ruler across T1 adds M1 to the Objects tab",
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, tool: "ruler" },
      }),
    },
    ...annotateScenes.map(({ scene, label, note }) => ({
      key: `annotate-${scene}`,
      label: `Annotate workspace · ${label}`,
      note,
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId/annotate",
        params,
        search: { task: taskId, scene },
      }),
    })),
    ...compareScenes.map(({ scene, label, note }) => ({
      key: `compare-${scene}`,
      label: `Compare slides · ${label}`,
      note,
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, scene },
      }),
    })),
    {
      key: "focus",
      label: "Focus mode",
      note: "Only the slide, the object card, the minimap and the magnification",
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, object: "T5", focus: true },
      }),
    },
    {
      key: "peek",
      label: "Whole-slide peek",
      note: "Hold Z, or click the minimap",
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, object: "T5", peek: true },
      }),
    },
  ];
}
