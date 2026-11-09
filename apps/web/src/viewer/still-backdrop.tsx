import type { ReactNode } from "react";
import {
  type StillDrawChoices,
  StillEngine,
  type StillLink,
  type StillObject,
} from "./still-engine.tsx";
import { useWebglAvailable } from "./webgl.ts";

export type Backdrop = (state: {
  camera: { x: number; y: number; scale: number };
  onReady: (link: StillLink | null) => void;
  onTiles: (failed: number) => void;
}) => ReactNode;

export const noResultsOn = (taskAsks: boolean, objects: readonly unknown[]) =>
  taskAsks && objects.length === 0;

export function engineBehindStill({
  cellView,
  tilesFailed,
  noResults,
  ownLayers = false,
}: {
  cellView: boolean;
  tilesFailed: boolean;
  noResults: boolean;
  ownLayers?: boolean;
}): boolean {
  return !cellView && !tilesFailed && !noResults && !ownLayers;
}

export function useStillBackdrop({
  enabled,
  slideId,
  objects,
  choices,
  hiddenClasses = noClasses,
}: {
  enabled: boolean;
  slideId: string;
  objects: readonly StillObject[] | null;
  choices: StillDrawChoices;
  hiddenClasses?: ReadonlySet<string>;
}): Backdrop | undefined {
  const webgl = useWebglAvailable();
  if (!enabled || !webgl) return undefined;
  return ({ camera, onReady, onTiles }) => (
    <StillEngine
      slideId={slideId}
      camera={camera}
      objects={objects}
      choices={choices}
      hiddenClasses={hiddenClasses}
      onReady={onReady}
      onTiles={onTiles}
    />
  );
}

const noClasses: ReadonlySet<string> = new Set();
