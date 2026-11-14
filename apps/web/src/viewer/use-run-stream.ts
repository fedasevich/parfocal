import { cancelModelRun, startModelRuns } from "@parfocal/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createVectorOverlay,
  finishedTileMarks,
  httpRunStreamSource,
  type OverlayRegistration,
  type PolygonBatch,
  type Rgba,
  type RunProgress,
  RunStream,
  type SceneBlock,
  StreamedScene,
  type ViewerEngine,
} from "./viewer-engine.ts";

export const runStreamDetector = "hovernet";
export const runStreamOverlayPrefix = "run-stream:";
const tilesOverlayId = `${runStreamOverlayPrefix}finished-tiles`;
const tileMarkColor: Rgba = [64, 160, 220, 48];
const classColors: readonly Rgba[] = [
  [214, 69, 65, 210],
  [65, 131, 215, 210],
  [46, 160, 67, 210],
  [230, 160, 40, 210],
  [150, 80, 200, 210],
];

export type RunStreamPhase = "idle" | "starting" | "streaming" | "ended" | "failed";

export type RunStreamState = {
  readonly phase: RunStreamPhase;
  readonly runId: string | null;
  readonly progress: RunProgress | null;
  readonly drawn: number;
};

export type RunStreamControls = RunStreamState & {
  readonly start: () => void;
  readonly cancel: () => void;
};

const idle: RunStreamState = { phase: "idle", runId: null, progress: null, drawn: 0 };

type Shown = { registration: OverlayRegistration; batch: PolygonBatch };

const colorOf = (classIndex: number): Rgba =>
  classColors[classIndex % classColors.length] ?? [0, 0, 0, 255];

export function useRunStream(options: {
  readonly engine: ViewerEngine;
  readonly projectId: string;
  readonly slideId: string;
  readonly taskId: string | null;
}): RunStreamControls {
  const { engine, projectId, slideId, taskId } = options;
  const [state, setState] = useState<RunStreamState>(idle);
  const stream = useRef<RunStream | null>(null);
  const shown = useRef(new Map<string, Shown>());

  const show = useCallback(
    (id: string, batch: PolygonBatch) => {
      const overlay = createVectorOverlay({ id, kind: "nuclei", shapes: { polygons: batch } });
      const before = shown.current.get(id);
      if (before === undefined) {
        shown.current.set(id, { registration: engine.registerOverlay(overlay), batch });
        return;
      }
      if (before.batch === batch) return;
      before.registration.update(overlay);
      shown.current.set(id, { registration: before.registration, batch });
    },
    [engine],
  );

  const clear = useCallback(() => {
    for (const entry of shown.current.values()) entry.registration.unregister();
    shown.current.clear();
  }, []);

  useEffect(
    () => () => {
      stream.current?.close();
      stream.current = null;
      clear();
      setState(idle);
    },
    [clear],
  );

  const draw = useCallback(
    (blocks: readonly SceneBlock[]) => {
      const live = new Set(blocks.map((block) => `${runStreamOverlayPrefix}${block.id}`));
      for (const [id, entry] of shown.current) {
        if (id !== tilesOverlayId && !live.has(id)) {
          entry.registration.unregister();
          shown.current.delete(id);
        }
      }
      for (const block of blocks) show(`${runStreamOverlayPrefix}${block.id}`, block.batch);
      const tiles = stream.current?.progress().tiles ?? [];
      show(tilesOverlayId, finishedTileMarks(tiles, tileMarkColor));
      const drawn = blocks.reduce((sum, block) => sum + block.batch.count, 0);
      setState((before) => ({ ...before, drawn }));
    },
    [show],
  );

  const start = useCallback(() => {
    if (stream.current !== null) return;
    setState({ ...idle, phase: "starting" });
    void (async () => {
      try {
        const response = await startModelRuns(projectId, {
          slide_ids: [slideId],
          task_id: taskId,
          scope: { kind: "slide" },
          parameters: { detector: { name: runStreamDetector } },
        });
        if (response.status !== 201) throw new Error("No run started");
        const runId = response.data[0]?.id;
        if (runId === undefined) throw new Error("No run started");
        const base = `/api/projects/${projectId}/model-runs/${runId}`;
        clear();
        const next = new RunStream({
          lineage: runId,
          scene: new StreamedScene(),
          source: httpRunStreamSource({
            areasUrl: (after) => `${base}/areas?after=${after}`,
            tileUrl: (unit) => `${base}/tiles/${unit}`,
            cancel: async () => {
              await cancelModelRun(projectId, runId);
            },
            colorOf,
          }),
          onRebuild: draw,
          onProgress: (progress) => setState((before) => ({ ...before, progress })),
        });
        stream.current = next;
        setState((before) => ({ ...before, phase: "streaming", runId }));
        const ended = await next.start();
        setState((before) => ({ ...before, phase: "ended", progress: ended }));
      } catch {
        setState((before) => ({ ...before, phase: "failed" }));
      } finally {
        stream.current = null;
      }
    })();
  }, [projectId, slideId, taskId, clear, draw]);

  const cancel = useCallback(() => {
    void stream.current?.cancel();
  }, []);

  return { ...state, start, cancel };
}
