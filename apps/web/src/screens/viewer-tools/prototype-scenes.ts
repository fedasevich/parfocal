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
        search: { task: taskId, tool: "ruler", scene: "objects" },
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
    {
      key: "compare",
      label: "Compare slides",
      note: "The slide on the left with the right side's slide list open",
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, layout: "compare" },
      }),
    },
    {
      key: "focus",
      label: "Focus mode",
      note: "Only the slide, the object card, the minimap and the magnification",
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, object: "T5", layout: "focus" },
      }),
    },
    {
      key: "peek",
      label: "Whole-slide peek",
      note: "Hold Z, or click the minimap",
      link: linkOptions({
        to: "/projects/$projectId/slides/$slideId",
        params,
        search: { task: taskId, object: "T5", peek: true, scene: "objects" },
      }),
    },
  ];
}
