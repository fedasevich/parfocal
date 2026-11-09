import type { ReactNode } from "react";
import { type StillDrawChoices, StillEngine, type StillObject } from "./still-engine.tsx";
import { webglAvailable } from "./webgl.ts";

type Backdrop = (state: {
  camera: { x: number; y: number; scale: number };
  onReady: (up: boolean) => void;
}) => ReactNode;

export function stillBackdrop({
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
  if (!enabled || !webglAvailable()) return undefined;
  return ({ camera, onReady }) => (
    <StillEngine
      slideId={slideId}
      camera={camera}
      objects={objects}
      choices={choices}
      hiddenClasses={hiddenClasses}
      onReady={onReady}
    />
  );
}

const noClasses: ReadonlySet<string> = new Set();
