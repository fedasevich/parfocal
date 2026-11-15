import { useViewerPanels } from "./use-viewer-panels.tsx";
import { useViewerScene } from "./use-viewer-scene.tsx";
import { useViewerState } from "./use-viewer-state.tsx";
import type { BodyProps } from "./viewer-model-types.ts";

export function useViewerModel(props: BodyProps) {
  const state = useViewerState(props);
  const scene = useViewerScene(props, state);
  const panels = useViewerPanels(props, { ...state, ...scene });
  return { ...state, ...scene, ...panels };
}
