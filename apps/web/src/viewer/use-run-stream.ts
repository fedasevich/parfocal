import { cancelModelRun } from "@parfocal/api-client";
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

const runStreamOverlayPrefix = "run-stream:";
const watchMs = 5000;
const watchedStatuses = ["queued", "running"] as const;
const tilesOverlayId = `${runStreamOverlayPrefix}finished-tiles`;
const tileMarkColor: Rgba = [64, 160, 220, 48];
const classColors: readonly Rgba[] = [
  [214, 69, 65, 210],
  [65, 131, 215, 210],
  [46, 160, 67, 210],
  [230, 160, 40, 210],
  [150, 80, 200, 210],
];

export type RunStreamPhase = "idle" | "streaming" | "ended" | "failed";

export type RunStreamState = {
  readonly phase: RunStreamPhase;
  readonly runId: string | null;
  readonly progress: RunProgress | null;
  readonly drawn: number;
};

export type RunStreamControls = RunStreamState & {
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
}): RunStreamControls {
  const { engine, projectId, slideId } = options;
  const [state, setState] = useState<RunStreamState>(idle);
  const stream = useRef<RunStream | null>(null);
  const shown = useRef(new Map<string, Shown>());
  const attached = useRef(new Set<string>());

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

  const attach = useCallback(
    (runId: string) => {
      if (stream.current !== null || attached.current.has(runId)) return;
      attached.current.add(runId);
      const base = `/api/projects/${projectId}/model-runs/${runId}`;
      void (async () => {
        try {
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
          setState({ ...idle, phase: "streaming", runId });
          const ended = await next.start();
          setState((before) => ({ ...before, phase: "ended", progress: ended }));
        } catch {
          setState((before) => ({ ...before, phase: "failed" }));
        } finally {
          stream.current = null;
        }
      })();
    },
    [projectId, clear, draw],
  );

  useEffect(() => {
    let stopped = false;
    const query = new URLSearchParams({ slide_id: slideId, limit: "1" });
    for (const status of watchedStatuses) query.append("status", status);
    const look = async () => {
      if (stopped || stream.current !== null) return;
      const response = await fetch(`/api/projects/${projectId}/model-runs?${query}`, {
        credentials: "same-origin",
      }).catch(() => null);
      if (stopped || response === null || !response.ok) return;
      const runs = (await response.json().catch(() => [])) as unknown;
      if (!Array.isArray(runs)) return;
      const found = (runs as readonly Partial<ListedRun>[]).find(
        (run) =>
          typeof run.id === "string" &&
          run.slide_id === slideId &&
          watchedStatuses.some((status) => status === run.status),
      );
      if (found?.id !== undefined) attach(found.id);
    };
    void look();
    const timer = setInterval(() => void look(), watchMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [projectId, slideId, attach]);

  const cancel = useCallback(() => {
    void stream.current?.cancel();
  }, []);

  return { ...state, cancel };
}

type ListedRun = { id: string; slide_id: string; status: string };

export function runStreamVisible(state: RunStreamState): boolean {
  if (state.phase === "streaming") return true;
  if (state.phase === "failed") return state.progress !== null;
  return state.phase === "ended" && state.progress?.status === "cancelled";
}
