import {
  getGetHeatmapGridUrl,
  type HeatmapFacts,
  type ResultSet,
  useGetHeatmap,
  useListSlideResultSets,
} from "@parfocal/api-client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useStageRect } from "../annotations/stage-size.ts";
import { okData } from "../screens/placeholder.tsx";
import { useDisplayDefaults } from "../shell/display-defaults.ts";
import { useStageDisplay } from "../viewer/stage-display.tsx";
import {
  colorizeHeatmap,
  defaultHeatmapLook,
  type HeatmapColormap,
  slideToScreen,
  type ViewerEngine,
} from "../viewer/viewer-engine.ts";

export type HeatmapChoice = { shown: boolean; colormap: HeatmapColormap };

export type HeatmapChoices = {
  choiceOf: (setId: string) => HeatmapChoice;
  change: (setId: string, next: Partial<HeatmapChoice>) => void;
};

export function useHeatmapChoices(): HeatmapChoices {
  const { colormap } = useDisplayDefaults();
  const firstChoice: HeatmapChoice = { shown: true, colormap };
  const [choices, setChoices] = useState<Readonly<Record<string, HeatmapChoice>>>({});
  return {
    choiceOf: (setId) => choices[setId] ?? firstChoice,
    change: (setId, next) =>
      setChoices((current) => ({
        ...current,
        [setId]: { ...(current[setId] ?? firstChoice), ...next },
      })),
  };
}

export const mayBeHeatmap = (set: ResultSet): boolean =>
  set.status === "ready" && set.cell_count === 0 && set.region_count === 0 && set.zone_count === 0;

export const useSetHeatmap = (set: ResultSet): HeatmapFacts | undefined =>
  okData(useGetHeatmap(set.id, { query: { enabled: mayBeHeatmap(set), retry: false } }).data);

async function fetchGrid(setId: string): Promise<Uint8Array> {
  const response = await fetch(getGetHeatmapGridUrl(setId), { credentials: "same-origin" });
  if (!response.ok) throw new Error("The heatmap grid could not be loaded");
  return new Uint8Array(await response.arrayBuffer());
}

function pictureOf(facts: HeatmapFacts, values: Uint8Array, colormap: HeatmapColormap): string {
  const rgba = colorizeHeatmap(
    {
      width: facts.width,
      height: facts.height,
      values,
      area: {
        x: 0,
        y: 0,
        width: facts.width * facts.downsample,
        height: facts.height * facts.downsample,
      },
    },
    { colormap, threshold: defaultHeatmapLook.threshold },
  );
  const canvas = document.createElement("canvas");
  canvas.width = facts.width;
  canvas.height = facts.height;
  canvas
    .getContext("2d")
    ?.putImageData(new ImageData(new Uint8ClampedArray(rgba), facts.width, facts.height), 0, 0);
  return canvas.toDataURL();
}

type HeatmapImageProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  set: ResultSet;
  choice: HeatmapChoice;
  opacity: number;
};

function HeatmapImage({ engine, stage, set, choice, opacity }: HeatmapImageProps) {
  const facts = useSetHeatmap(set);
  const grid = useQuery({
    queryKey: ["heatmap-grid", set.id],
    queryFn: () => fetchGrid(set.id),
    enabled: facts !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const picture = useMemo(
    () =>
      facts === undefined ||
      grid.data === undefined ||
      grid.data.length !== facts.width * facts.height
        ? null
        : pictureOf(facts, grid.data, choice.colormap),
    [facts, grid.data, choice.colormap],
  );
  if (facts === undefined || picture === null || !choice.shown) return null;
  const from = slideToScreen(camera, rect, { x: 0, y: 0 });
  const to = slideToScreen(camera, rect, {
    x: facts.width * facts.downsample,
    y: facts.height * facts.downsample,
  });
  return (
    <img
      alt=""
      aria-hidden="true"
      data-testid="heatmap-layer"
      data-set={set.id}
      data-colormap={choice.colormap}
      src={picture}
      className="pointer-events-none absolute max-w-none"
      style={{
        left: from.x,
        top: from.y,
        width: to.x - from.x,
        height: to.y - from.y,
        opacity,
      }}
    />
  );
}

type HeatmapLayersProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  slideId: string;
  choices: HeatmapChoices;
  taskId?: string | undefined;
};

export function HeatmapLayers({ engine, stage, slideId, choices, taskId }: HeatmapLayersProps) {
  const sets = okData(useListSlideResultSets(slideId).data) ?? [];
  const { heatmapOpacity } = useDisplayDefaults();
  const { heatmap } = useStageDisplay(taskId);
  const opacity = (heatmap > 0 ? heatmap : heatmapOpacity) / 100;
  return (
    <>
      {sets.filter(mayBeHeatmap).map((set) => (
        <HeatmapImage
          key={set.id}
          engine={engine}
          stage={stage}
          set={set}
          choice={choices.choiceOf(set.id)}
          opacity={opacity}
        />
      ))}
    </>
  );
}
