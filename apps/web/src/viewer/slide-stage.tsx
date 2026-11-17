import { Trans, useLingui } from "@lingui/react/macro";
import { listProjectClasses, type ProjectClass } from "@parfocal/api-client";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Loader } from "@parfocal/ui/components/loader";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { ToolRail, ToolRailButton, ToolRailGroup } from "@parfocal/ui/components/tool-rail-button";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSharedSmartServices } from "../aiseg/shared-smart-services.ts";
import {
  loadSmartServices,
  type SmartServicesContext,
  shareServices,
} from "../aiseg/smart-services.ts";
import { type AnnotateTask, taskClassesOf } from "../annotations/annotate-task.ts";
import { ArrowLayer } from "../annotations/arrow-layer.tsx";
import { AutoLayer } from "../annotations/auto-layer.tsx";
import { BrushLayer } from "../annotations/brush-layer.tsx";
import { useClassKeys } from "../annotations/class-keys.ts";
import { maxClassKeys } from "../annotations/classes.ts";
import {
  clearAll,
  clearPrompt,
  deleteShapes,
  needsClearConfirmation,
} from "../annotations/clear.ts";
import { ConflictNotice } from "../annotations/conflict-notice.tsx";
import { contextBarOf, takesActiveClass } from "../annotations/context-bar.ts";
import { ContextBarView } from "../annotations/context-bar.tsx";
import { CountLayer } from "../annotations/count-layer.tsx";
import { markersOf } from "../annotations/count-markers.ts";
import { CountPanel } from "../annotations/count-panel.tsx";
import { DragLayer } from "../annotations/drag-layer.tsx";
import { FreehandLayer } from "../annotations/freehand-layer.tsx";
import { LayersPanel } from "../annotations/layers-panel.tsx";
import { LiveChangesMarker } from "../annotations/live-changes-marker.tsx";
import { PinLayer } from "../annotations/pin-layer.tsx";
import { createPinRegistry } from "../annotations/pin-registry.ts";
import { type DraftControl, PolygonLayer } from "../annotations/polygon-layer.tsx";
import { ProposalLayer } from "../annotations/proposal-layer.tsx";
import { SaveStatus } from "../annotations/save-status.tsx";
import { SelectLayer } from "../annotations/select-layer.tsx";
import type { ShapeId } from "../annotations/shapes.ts";
import { SmartLayer } from "../annotations/smart-layer.tsx";
import { type TextControl, TextLayer } from "../annotations/text-layer.tsx";
import { useLiveGuardFeed } from "../annotations/use-live-guard.ts";
import { useProposals } from "../annotations/use-proposals.ts";
import {
  idleGuard,
  type LiveGuard,
  useSavedAnnotations,
} from "../annotations/use-saved-annotations.ts";
import { provideDebug } from "../debug-handle.ts";
import { createCameraInput } from "../devices/camera-input.ts";
import { legendDeviceOf } from "../devices/device-legend.ts";
import { DeviceLegend } from "../devices/device-legend.tsx";
import { bindGamepadWhenConnected, deviceIntentEvent } from "../devices/gamepad-source.ts";
import { dispatchIntentKey, steppedPreset } from "../devices/intent-keys.ts";
import { engineWheelMode, navigationEvent, readNavigation } from "../devices/navigation.ts";
import { createPenDoubleTap, createToolHistory } from "../devices/pen-touch.ts";
import { bindSpaceMouse, type HidLike, hasWebHid } from "../devices/spacemouse-source.ts";
import { applyMainCalibration, mainCalibration } from "../devices/stage-calibration.ts";
import { bindTrackpadListeners } from "../devices/trackpad-listeners.ts";
import { EscProvider, useEscOwner, useNewEscRegistry } from "../keys/esc-owner.tsx";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { MeasurementList } from "../measure/measurement-list.tsx";
import { RulerLayer } from "../measure/ruler-layer.tsx";
import { SharedCursorLayer } from "../presence/live-cursor.tsx";
import { registerStageEngine } from "../presence/stage-engines.ts";
import { AddResultSet } from "../results/add-result-set.tsx";
import type { ParsedResults, Placement } from "../results/geojson-placement.ts";
import { HeatmapLayers, useHeatmapChoices } from "../results/heatmap-layer.tsx";
import { PaintedMapLayer } from "../results/painted-map-layer.tsx";
import { PreviewLayer } from "../results/preview-layer.tsx";
import { ResultSetLayers } from "../results/result-set-layers.tsx";
import { ViewMapLayer } from "../results/view-map-layer.tsx";
import { useInspectorLayout } from "../screens/review/inspector-layout.ts";
import { annotateRail } from "../screens/viewer-tools/rails.ts";
import { useDeveloperMode } from "../shell/developer-mode.ts";
import { readDeviceSettings } from "../shell/device-settings.ts";
import { useMagnificationLabel } from "../shell/magnification-label-setting.ts";
import { useSavedOutlineMode } from "../shell/outline-mode-setting.ts";
import { useResolvedSettings } from "../shell/resolved-settings.ts";
import { useToolsLayout } from "../shell/tools-layout.ts";
import { appFrameReporter } from "../telemetry/frame-monitor.ts";
import { useFrameMonitor } from "../telemetry/use-frame-monitor.ts";
import { AnnotateTaskPanel } from "./annotate-task-panel.tsx";
import { AreaKeys } from "./area-keys.tsx";
import {
  DockCard,
  type InspectorSection,
  type InspectorSlots,
  InspectorSlotsProvider,
} from "./inspector-slots.tsx";
import { followLabPrefetch, labRouteOptions, labRouteSource } from "./lab-route.ts";
import { loadViewerEngine } from "./load-engine.ts";
import { MagnificationControl, type ViewerModule } from "./magnification-control.tsx";
import { ObjectDrawLayer } from "./object-draw-layer.tsx";
import { describeOpenFailure, type OpenFailure } from "./open-failure.ts";
import { OutlineLayer } from "./outline-layer.tsx";
import { type OutlineModeChoice, outlineModeChoices, outlineModeLabels } from "./outline-mode.ts";
import { type EngineRouteId, pickRoutes, type RoutePicker } from "./route-picker.ts";
import { RunStreamLayer } from "./run-stream-layer.tsx";
import type { SlideAreaEntry } from "./slide-areas.ts";
import { useSlideBrightness } from "./slide-brightness.ts";
import { useSlideCoverage } from "./slide-coverage.ts";
import { StageInspector } from "./stage-inspector.tsx";
import { stageToolOf } from "./stage-tools.ts";
import { grantFor, type SlideStorageNote } from "./tile-grant.ts";
import { FailedTilePlaceholders, SlideChecker, TileHintChip } from "./tile-loading.tsx";
import type { ScanTissue } from "./tissue-scan.ts";
import { useTissueScan } from "./use-tissue-scan.ts";
import { useViewerKeys } from "./use-viewer-keys.ts";
import { ViewedPeek } from "./viewed-peek.tsx";
import type { ViewerEngine, VivRoute } from "./viewer-engine.ts";
import { type SelectionArea, selectionArea, zoomTargetArea } from "./viewer-keys.ts";
import { railHasTool, type SlideWorkspace, showsCountPanel, workspaceSetups } from "./workspace.ts";

type Phase =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly fittedMs: number }
  | { readonly state: "failed"; readonly failure: OpenFailure };

type ViewerTool = string;

const toolOfAction: Readonly<Record<string, ViewerTool>> = Object.fromEntries(
  annotateRail
    .flat()
    .flatMap((item) => (item.action === undefined ? [] : [[item.action, item.tool]])),
);

const railActions = annotateRail.flatMap((group) =>
  group.flatMap((item) => (item.action === undefined ? [] : [item.action])),
);

const LabLayer = lazy(() => import("./lab-layer.tsx"));

type Session = {
  readonly engine: ViewerEngine;
  readonly module: ViewerModule;
  readonly open: SmartServicesContext["open"];
  readonly route: VivRoute | null;
  readonly shownRoute: EngineRouteId;
};

function ViewerKeys({
  session,
  selection,
}: {
  session: Session;
  selection: () => SelectionArea | null;
}) {
  useViewerKeys(session.engine, session.module, selection);
  return null;
}

export type ViewedLink = {
  peek: boolean;
  onPeekClose: () => void;
  onPercent: (percent: number | null) => void;
};

function ScanKeys({
  session,
  host,
  tissue,
}: {
  session: Session;
  host: HTMLDivElement;
  tissue: ScanTissue | null;
}) {
  const { scan, arrived } = useTissueScan(session.engine, session.module, host, tissue, true);
  return (
    <div
      hidden
      data-testid="tissue-scan"
      data-step={scan?.step ?? 0}
      data-fields={scan?.path.length ?? ""}
      data-arrived={arrived}
      data-basis={tissue === null ? "slide" : "tissue"}
    />
  );
}

export function SlideStage({
  slideId,
  projectId,
  taskId,
  areas = [],
  viewed,
  systematicScan = false,
  outlines = false,
  workspace = "annotate",
  annotateTask = null,
  layerKnown = true,
  onOpenSlide,
  onStorage,
}: {
  slideId: string;
  projectId?: string;
  taskId?: string;
  annotateTask?: AnnotateTask | null;
  layerKnown?: boolean;
  onOpenSlide?: (slideId: string) => void;
  onStorage?: (note: SlideStorageNote) => void;
  areas?: readonly SlideAreaEntry[];
  viewed?: ViewedLink;
  systematicScan?: boolean;
  outlines?: boolean;
  workspace?: SlideWorkspace;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <OpenedSlide
      key={attempt}
      slideId={slideId}
      projectId={projectId}
      taskId={taskId}
      areas={areas}
      viewed={viewed}
      systematicScan={systematicScan}
      outlines={outlines}
      workspace={workspace}
      annotateTask={annotateTask}
      layerKnown={layerKnown}
      onOpenSlide={onOpenSlide}
      onStorage={onStorage}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}

function OpenedSlide({
  slideId,
  projectId,
  taskId,
  areas,
  viewed,
  systematicScan,
  outlines,
  workspace,
  annotateTask,
  layerKnown,
  onOpenSlide,
  onStorage,
  onRetry,
}: {
  slideId: string;
  projectId: string | undefined;
  taskId: string | undefined;
  annotateTask: AnnotateTask | null;
  layerKnown: boolean;
  onOpenSlide: ((slideId: string) => void) | undefined;
  onStorage: ((note: SlideStorageNote) => void) | undefined;
  areas: readonly SlideAreaEntry[];
  viewed: ViewedLink | undefined;
  systematicScan: boolean;
  outlines: boolean;
  workspace: SlideWorkspace;
  onRetry: () => void;
}) {
  const { t } = useLingui();
  const host = useRef<HTMLDivElement | null>(null);
  const storageNote = useRef(onStorage);
  storageNote.current = onStorage;
  const doubleClick = useRef<"zoom" | "toggle">("zoom");
  const settings = useResolvedSettings();
  doubleClick.current = settings?.double_click ?? "zoom";
  const outlineTier = settings?.tier_outline ?? "best";
  const [hostNode, setHostNode] = useState<HTMLDivElement | null>(null);
  const pinRegistry = useMemo(createPinRegistry, []);
  const pageServices = useSharedSmartServices();
  const ownServices = useMemo(() => shareServices(loadSmartServices), []);
  const sharedServices = pageServices ?? ownServices;
  const hostRef = useCallback((node: HTMLDivElement | null) => {
    host.current = node;
    setHostNode(node);
  }, []);
  const setup = workspaceSetups[workspace];
  const restingTool: ViewerTool = setup.restingTool;
  const [tool, setTool] = useState<ViewerTool>(restingTool);
  const [addingResults, setAddingResults] = useState(false);
  const heatmapChoices = useHeatmapChoices();
  const [resultPreview, setResultPreview] = useState<{
    results: ParsedResults;
    placement: Placement;
  } | null>(null);
  const closeAddResults = useCallback(() => setAddingResults(false), []);
  useEffect(() => setTool(restingTool), [restingTool]);
  const toolBindings = useBindings(["annotate"], railActions);
  const onToolKey = useCallback(
    ({ phase, action }: { phase: string; action: string }) => {
      const railTool = toolOfAction[action];
      if (phase !== "press" || railTool === undefined || !railHasTool(setup, railTool)) return;
      const pressed = stageToolOf(railTool);
      if (pressed === "hand") {
        setTool("hand");
        return;
      }
      setTool((current) => (current === pressed ? restingTool : pressed));
    },
    [setup, restingTool],
  );
  useHotkeys(toolBindings, onToolKey);
  const escRegistry = useNewEscRegistry();
  useEscOwner(escRegistry);
  useEffect(
    () =>
      escRegistry.add("tool", {
        open: () => tool !== restingTool,
        peel: () => setTool(restingTool),
      }),
    [escRegistry, tool, restingTool],
  );
  const draftControl = useRef<DraftControl | null>(null);
  const textControl = useRef<TextControl | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const [session, setSession] = useState<Session | null>(null);
  const [opened, setOpened] = useState<{
    readonly engine: ViewerEngine;
    readonly route: VivRoute | null;
  } | null>(null);
  const developerMode = useDeveloperMode();
  const [brightness, setBrightness] = useSlideBrightness();
  const magnificationLabel = useMagnificationLabel();
  const toolsLayout = useToolsLayout();
  const [inspectorLayout, setInspectorLayout] = useInspectorLayout();
  const [slots, setSlots] = useState<InspectorSlots>({});
  const placeSlot = useCallback((section: InspectorSection, node: HTMLElement | null) => {
    setSlots((current) => (current[section] === node ? current : { ...current, [section]: node }));
  }, []);
  const chosenDevice = useMemo(() => readDeviceSettings().device, []);
  const [outlineMode, setOutlineMode] = useSavedOutlineMode();
  const sharedTaskId = annotateTask?.taskId ?? null;
  const snapshot = annotateTask?.classes ?? null;
  const liveGuard = useRef<LiveGuard>(idleGuard);
  const [selectedIds, setSelectedIds] = useState<readonly ShapeId[]>([]);
  const focusedArea = useRef<SelectionArea | null>(null);
  const saved = useSavedAnnotations(
    slideId,
    session !== null && layerKnown,
    sharedTaskId,
    liveGuard,
  );
  useLiveGuardFeed(liveGuard, {
    engine: session?.engine ?? null,
    stage: hostNode,
    latest: saved.latest,
    noteActivity: saved.noteActivity,
    drafting: () => (draftControl.current?.depth() ?? 0) > 0,
    selected: selectedIds,
  });
  const annotations = saved.document;
  const selectedBox = useMemo(
    () =>
      selectionArea(
        selectedIds.flatMap((id) => {
          const shape = annotations.shapes.get(id);
          return shape === undefined ? [] : [shape.bounds];
        }),
      ),
    [annotations.shapes, selectedIds],
  );
  const proposals = useProposals(saved, slideId);
  const setAnnotations = saved.setDocument;
  const undoBindings = useBindings(["global"], ["undo", "redo"]);
  const { undo: undoEdit, redo: redoEdit } = saved;
  const onUndoKey = useCallback(
    ({ phase, action }: { phase: string; action: string }) => {
      if (phase !== "press") return;
      if (action === "redo") {
        redoEdit();
        return;
      }
      if (action !== "undo") return;
      const draft = draftControl.current;
      if (draft !== null && draft.depth() > 0) draft.pop();
      else if (textControl.current?.restore() !== true) undoEdit();
    },
    [undoEdit, redoEdit],
  );
  useHotkeys(undoBindings, onUndoKey);
  const [projectClasses, setProjectClasses] = useState<readonly ProjectClass[]>([]);
  const [activeClass, setActiveClass] = useState<string | null>(null);
  useEffect(() => {
    if (snapshot !== null || projectId === undefined) return;
    let cancelled = false;
    void listProjectClasses(projectId).then(
      (response) => {
        if (cancelled || response.status !== 200) return;
        setProjectClasses(response.data);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, snapshot]);
  const classes = useMemo(
    () => taskClassesOf(snapshot, projectClasses),
    [snapshot, projectClasses],
  );
  useEffect(() => {
    setActiveClass((current) => current ?? classes[0]?.id ?? null);
  }, [classes]);
  const pickSlot = useCallback(
    (slot: number) => {
      const picked = classes[slot - 1];
      if (picked !== undefined) setActiveClass(picked.id);
    },
    [classes],
  );
  const classTool = takesActiveClass(tool);
  useClassKeys(pickSlot, classTool);
  const pickClassKey = useCallback((classKey: string) => setActiveClass(classKey), []);
  const activeIndex = classes.findIndex((item) => item.id === activeClass);
  const activeInfo = activeIndex < 0 ? null : (classes[activeIndex] ?? null);
  const markerTotal = markersOf(annotations).length;
  const contextModel = contextBarOf(tool, {
    activeSlot: activeIndex < 0 || activeIndex >= maxClassKeys ? null : activeIndex + 1,
    activeName: activeInfo?.name ?? null,
    counted: markerTotal,
  });
  const {
    pending: pendingProposals,
    accept: acceptProposals,
    discard: discardProposals,
  } = proposals;
  const proposalCount = pendingProposals.length;
  const proposalNow = useRef({ proposalCount, acceptProposals, discardProposals });
  proposalNow.current = { proposalCount, acceptProposals, discardProposals };
  useEffect(
    () =>
      escRegistry.add("run", {
        open: () => proposalNow.current.proposalCount > 0,
        peel: () => proposalNow.current.discardProposals(),
      }),
    [escRegistry],
  );
  useEffect(() => {
    const onEnter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      if (proposalNow.current.proposalCount === 0) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, button, [contenteditable]")
      )
        return;
      if ((draftControl.current?.depth() ?? 0) > 0) return;
      event.preventDefault();
      proposalNow.current.acceptProposals();
    };
    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, []);
  const closeShape = useCallback(
    (points: Float32Array) => saved.savePolygon(points, activeClass),
    [saved.savePolygon, activeClass],
  );
  const colourOf = useCallback(
    (classKey: string | null) =>
      classes.find((item) => item.id === classKey)?.colour ?? "var(--color-accent)",
    [classes],
  );
  const dropAt = useCallback(
    (point: { x: number; y: number }) => saved.saveMarker(point, activeClass),
    [saved.saveMarker, activeClass],
  );
  const coverage = useSlideCoverage(
    session?.engine ?? null,
    session?.module ?? null,
    slideId,
    hostNode,
  );

  const percent = coverage?.loaded ? coverage.percent : null;
  const reportPercent = viewed?.onPercent;
  useEffect(() => {
    reportPercent?.(percent);
    return () => reportPercent?.(null);
  }, [percent, reportPercent]);

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    let disposed = false;
    let dispose: (() => void) | null = null;
    const startedAt = performance.now();
    const fail = (error: unknown) => {
      if (!disposed) setPhase({ state: "failed", failure: describeOpenFailure(error) });
    };
    void loadViewerEngine().then((engine) => {
      if (disposed) return;
      const access = engine.createSlideAccess(async (previous) => {
        const grant = await grantFor(slideId, previous);
        if (!disposed) storageNote.current?.({ storage: grant.storage, offline: grant.offline });
        return grant;
      });
      const open = async () => {
        const grant = await access.grant();
        return engine.signedOpenRequest({
          access: access.access,
          basePath: grant.basePath,
          original: grant.original,
          identifiedFormat: grant.format ?? null,
        });
      };
      let picker: RoutePicker | null = null;
      const alternateError = (error: Error) => {
        const live = viewport.liveRoute() as { failure?: () => Error | null } | null;
        if (live?.failure?.() != null) void picker?.fallBack(error);
        else console.warn(error);
      };
      const viewport = engine.mountSlideViewport({
        container,
        slideId,
        route: { onError: fail, onTileError: () => {}, ...labRouteOptions() },
        deckWebGpu: { onError: alternateError, onTileError: () => {} },
        input: {
          wheelMode: engineWheelMode(readNavigation().wheel),
          doubleClick: () => doubleClick.current,
          objectiveDetents: () => {
            if (!readNavigation().objectiveDetents) return null;
            const micronsPerPixel = viewport.engine.getSlide()?.micronsPerPixel ?? null;
            if (micronsPerPixel === null) return null;
            return { zoom: viewport.engine.getZoomGoal(), micronsPerPixel };
          },
        },
        resolve: open,
      });
      applyMainCalibration(viewport.engine);
      const followNavigation = () => {
        applyMainCalibration(viewport.engine);
        viewport.input.setWheelMode(engineWheelMode(readNavigation().wheel));
      };
      window.addEventListener(navigationEvent, followNavigation);
      let unfollow = () => {};
      const followRoute = () => {
        unfollow();
        unfollow = followLabPrefetch(viewport.route());
        if (disposed) return;
        setOpened({ engine: viewport.engine, route: viewport.route() });
        setSession((previous) =>
          previous === null
            ? null
            : { ...previous, route: viewport.route(), shownRoute: viewport.shownRoute() },
        );
      };
      const unprovide = provideDebug({
        getRoute: () => viewport.shownRoute(),
        jumpTo: async ({ x, y, magnification }) => {
          const micronsPerPixel = viewport.engine.getSlide()?.micronsPerPixel ?? null;
          if (micronsPerPixel === null) throw new Error("The slide has no pixel size");
          const started = performance.now();
          viewport.engine.setCamera({
            x,
            y,
            zoom: engine.zoomForMagnification(micronsPerPixel, magnification),
          });
          await viewport.liveRoute()?.whenIdle();
          return performance.now() - started;
        },
      });
      dispose = () => {
        window.removeEventListener(navigationEvent, followNavigation);
        unprovide();
        picker?.dispose();
        unfollow();
        viewport.dispose();
      };
      const settleShown = async (): Promise<void> => {
        try {
          await viewport.liveRoute()?.whenIdle();
        } catch (error) {
          if (viewport.shownRoute() === "viv") throw error;
          await picker?.fallBack(error instanceof Error ? error : new Error(String(error)));
          await viewport.liveRoute()?.whenIdle();
        }
      };
      viewport.ready
        .then(() => {
          if (disposed) return;
          picker = pickRoutes({
            viewport,
            source: labRouteSource,
            onShown: (_shown, refused) => {
              if (refused !== null) console.warn(refused);
              followRoute();
            },
          });
          followRoute();
          return picker.settled.then(settleShown);
        })
        .then(() => {
          if (disposed) return;
          setSession({
            engine: viewport.engine,
            module: engine,
            open,
            route: viewport.route(),
            shownRoute: viewport.shownRoute(),
          });
          setPhase({ state: "ready", fittedMs: performance.now() - startedAt });
        })
        .catch(fail);
    }, fail);
    return () => {
      disposed = true;
      setOpened(null);
      dispose?.();
    };
  }, [slideId]);

  useEffect(() => {
    if (session === null) return;
    return registerStageEngine(slideId, session.engine);
  }, [session, slideId]);

  useEffect(() => {
    if (session === null || hostNode === null) return;
    const mark = () => {
      const camera = session.engine.getCamera();
      hostNode.dataset["camera"] =
        `${camera.x.toFixed(3)},${camera.y.toFixed(3)},${camera.zoom.toFixed(4)}`;
    };
    mark();
    return session.engine.subscribeCamera(mark);
  }, [session, hostNode]);

  const toolHistory = useRef(createToolHistory<ViewerTool>(restingTool));
  useEffect(() => {
    toolHistory.current.select(tool);
  }, [tool]);

  useEffect(() => {
    const surface = hostNode?.parentElement;
    if (!surface) return;
    const doubleTap = createPenDoubleTap();
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "pen" || event.button !== 0 || event.buttons > 1) return;
      const twice = doubleTap.tap({ at: event.timeStamp, x: event.clientX, y: event.clientY });
      if (twice) setTool(toolHistory.current.swap());
    };
    surface.addEventListener("pointerdown", onDown, true);
    return () => surface.removeEventListener("pointerdown", onDown, true);
  }, [hostNode]);

  useEffect(() => {
    const surface = hostNode?.parentElement;
    if (session === null || !hostNode || !surface) return;
    return bindTrackpadListeners(surface, {
      device: () => legendDeviceOf(chosenDevice),
      context: () => (workspace === "annotate" ? "annotate" : "review"),
      calibration: mainCalibration,
      onIntent: (intent, at) => {
        hostNode.dataset["trackpadIntent"] = intent.kind;
        if (intent.kind === "zoom") {
          session.engine.zoomBy(intent.octaves, at, { animate: intent.animate });
        }
      },
    });
  }, [session, hostNode, chosenDevice, workspace]);

  useEffect(() => {
    if (session === null || typeof navigator === "undefined" || !("getGamepads" in navigator)) {
      return;
    }
    const input = createCameraInput({
      device: () => legendDeviceOf(chosenDevice),
      context: () => (workspace === "annotate" ? "annotate" : "review"),
      calibration: mainCalibration,
      camera: session.engine,
      onIntent: (intent) => {
        if (intent.kind === "presetStep") {
          const spacing = session.engine.getSlide()?.micronsPerPixel ?? null;
          const current = session.module.effectiveMagnification(
            session.engine.getCamera().zoom,
            spacing,
          );
          if (current !== null) {
            session.engine.zoomToMagnification(steppedPreset(current, intent.step));
          }
          return;
        }
        if (dispatchIntentKey(intent, window)) return;
        window.dispatchEvent(new CustomEvent(deviceIntentEvent, { detail: intent }));
      },
    });
    return bindGamepadWhenConnected(
      input,
      {
        getPads: () => navigator.getGamepads(),
        frames: {
          request: (cb) => requestAnimationFrame(cb),
          cancel: (id) => cancelAnimationFrame(id),
        },
        now: () => performance.now(),
        focused: () => document.hasFocus() && document.visibilityState === "visible",
      },
      window,
    );
  }, [session, chosenDevice, workspace]);

  useEffect(() => {
    if (session === null || typeof navigator === "undefined" || !hasWebHid(navigator)) return;
    const input = createCameraInput({
      device: () => legendDeviceOf(chosenDevice),
      context: () => (workspace === "annotate" ? "annotate" : "review"),
      calibration: mainCalibration,
      camera: session.engine,
      onIntent: (intent) => {
        window.dispatchEvent(new CustomEvent(deviceIntentEvent, { detail: intent }));
      },
    });
    return bindSpaceMouse(input, {
      hid: (navigator as unknown as { hid: HidLike }).hid,
      now: () => performance.now(),
      focused: () => document.hasFocus() && document.visibilityState === "visible",
      rotation: () => readDeviceSettings().spaceMouseRotation === true,
    });
  }, [session, chosenDevice, workspace]);

  useEffect(() => {
    session?.engine.setSlideBrightness(brightness);
  }, [session, brightness]);

  useFrameMonitor(hostNode, session?.shownRoute, appFrameReporter);

  const railButtons = (item: (typeof setup.rail)[number][number]) => {
    const stageTool = stageToolOf(item.tool);
    return (
      <ToolRailButton
        key={item.tool}
        icon={item.icon}
        label={item.label}
        tipSide={toolsLayout === "dock" ? "top" : "right"}
        ai={item.ai ?? false}
        {...(item.action === undefined ? {} : { action: item.action })}
        data-tool={item.tool}
        className={toolsLayout === "dock" ? undefined : "[@media(max-height:760px)]:size-7"}
        pressed={tool === stageTool}
        onPressedChange={(on) => setTool(on ? stageTool : restingTool)}
      />
    );
  };
  const panelLabel = inspectorLayout.hidden ? t`Show the side panel` : t`Hide the side panel`;
  const panelButton = (
    <ToolRailButton
      icon="panel"
      label={panelLabel}
      tipSide={toolsLayout === "dock" ? "top" : "right"}
      pressed={!inspectorLayout.hidden}
      onPressedChange={() => setInspectorLayout((current) => ({ hidden: !current.hidden }))}
    />
  );
  const initialTab: InspectorSection =
    taskId === undefined && workspace === "annotate" ? "display" : "objects";

  return (
    <EscProvider value={escRegistry}>
      <InspectorSlotsProvider value={slots}>
        <div data-slot="viewer-body" className="relative flex size-full min-h-0 bg-chrome">
          {toolsLayout === "dock" ? null : (
            <ToolRail className="justify-between">
              <div className="grid gap-1">
                {setup.rail.map((group) => (
                  <ToolRailGroup key={group.map((item) => item.tool).join("-")}>
                    {group.map(railButtons)}
                  </ToolRailGroup>
                ))}
              </div>
              <ToolRailGroup>{panelButton}</ToolRailGroup>
            </ToolRail>
          )}
          <div
            data-testid="slide-stage"
            data-state={phase.state}
            data-fitted-ms={phase.state === "ready" ? Math.round(phase.fittedMs) : undefined}
            data-renderer-route={session?.shownRoute}
            data-tool={tool}
            data-workspace={workspace}
            data-tools={toolsLayout}
            data-layer={sharedTaskId === null ? "slide" : "shared"}
            data-drag={setup.dragBehaviour}
            data-annotations={saved.loaded ? "loaded" : "loading"}
            data-save-state={saved.saveState}
            data-coverage={coverage?.loaded ? "loaded" : "loading"}
            data-coverage-percent={coverage?.percent}
            data-coverage-seen={coverage?.share.seen}
            data-coverage-pending={coverage?.pending}
            data-coverage-basis={coverage?.share.basis}
            className="relative min-h-0 min-w-0 flex-1 bg-chrome data-[tool=polygon]:**:cursor-crosshair! data-[tool=freehand]:**:cursor-crosshair! data-[tool=brush]:**:cursor-crosshair! data-[tool=rectangle]:**:cursor-crosshair! data-[tool=ellipse]:**:cursor-crosshair! data-[tool=marker]:**:cursor-crosshair! data-[tool=arrow]:**:cursor-crosshair! data-[tool=text]:**:cursor-text! data-[tool=ruler]:**:cursor-crosshair! data-[tool=comment]:**:cursor-crosshair! data-[tool=smart]:**:cursor-crosshair! data-[tool=auto]:**:cursor-crosshair!"
          >
            {opened && hostNode ? <SlideChecker engine={opened.engine} stage={hostNode} /> : null}
            <div ref={hostRef} data-testid="slide-host" className="absolute inset-0" />
            {opened?.route && hostNode ? (
              <FailedTilePlaceholders
                engine={opened.engine}
                route={opened.route}
                stage={hostNode}
              />
            ) : null}
            {phase.state === "failed" ? null : <TileHintChip route={opened?.route ?? null} />}
            {session && developerMode ? (
              <Suspense fallback={null}>
                <LabLayer
                  engine={session.engine}
                  route={session.route}
                  shownRoute={session.shownRoute}
                />
              </Suspense>
            ) : null}
            {session && hostNode ? (
              <>
                <SharedCursorLayer slideId={slideId} engine={session.engine} stage={hostNode} />
                <RulerLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "ruler"}
                  document={annotations}
                  onApply={saved.apply}
                />
                <PolygonLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "polygon"}
                  document={annotations}
                  onClose={closeShape}
                  draftControl={draftControl}
                />
                <FreehandLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "freehand"}
                  onClose={closeShape}
                />
                <BrushLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "brush"}
                  document={annotations}
                  classKey={activeClass}
                  colour={colourOf(activeClass)}
                  onApply={saved.apply}
                />
                <DragLayer
                  engine={session.engine}
                  stage={hostNode}
                  kind="rectangle"
                  active={tool === "rectangle"}
                  onClose={closeShape}
                />
                <DragLayer
                  engine={session.engine}
                  stage={hostNode}
                  kind="ellipse"
                  active={tool === "ellipse"}
                  onClose={closeShape}
                />
                <CountLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "marker"}
                  document={annotations}
                  colourOf={colourOf}
                  onDrop={dropAt}
                  onRemove={saved.removeMarker}
                />
                <ArrowLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "arrow"}
                  document={annotations}
                  onApply={saved.apply}
                />
                <TextLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "text"}
                  document={annotations}
                  onApply={saved.apply}
                  control={textControl}
                />
                <SelectLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "select"}
                  document={annotations}
                  onDocumentChange={setAnnotations}
                  onCommit={saved.commit}
                  onEditText={(id) => textControl.current?.edit(id)}
                  onSelectionChange={setSelectedIds}
                  pinRegistry={pinRegistry}
                />
                <PinLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "comment"}
                  selecting={tool === "select"}
                  registry={pinRegistry}
                  document={annotations}
                  projectId={projectId}
                  taskId={taskId}
                  slideId={slideId}
                  micronsPerPixel={session.engine.getSlide()?.micronsPerPixel ?? null}
                  onDocumentChange={setAnnotations}
                  onCommit={saved.commit}
                />
                <SmartLayer
                  engine={session.engine}
                  stage={hostNode}
                  slideId={slideId}
                  active={tool === "smart"}
                  document={annotations}
                  activeClass={activeClass}
                  loader={sharedServices}
                  openRequest={session.open}
                  onDocumentChange={setAnnotations}
                />
                <AutoLayer
                  engine={session.engine}
                  stage={hostNode}
                  active={tool === "auto"}
                  document={annotations}
                  activeClass={activeClass}
                  loader={sharedServices}
                  openRequest={session.open}
                  tier={outlineTier}
                  onDocumentChange={setAnnotations}
                />
                <ProposalLayer
                  engine={session.engine}
                  stage={hostNode}
                  proposals={proposals.pending}
                />
                <HeatmapLayers
                  engine={session.engine}
                  stage={hostNode}
                  slideId={slideId}
                  choices={heatmapChoices}
                />
                {workspace === "annotate" ? null : (
                  <ViewMapLayer engine={session.engine} stage={hostNode} slideId={slideId} />
                )}
                {workspace === "annotate" ? null : (
                  <PaintedMapLayer engine={session.engine} stage={hostNode} slideId={slideId} />
                )}
                {workspace === "annotate" ? (
                  <RunStreamLayer
                    key={slideId}
                    engine={session.engine}
                    stage={hostNode}
                    selection={selectedBox}
                    task={annotateTask}
                    projectId={projectId}
                    slideId={slideId}
                    startShown={tool !== "smart"}
                  />
                ) : null}
                {resultPreview === null ? null : (
                  <PreviewLayer
                    engine={session.engine}
                    stage={hostNode}
                    results={resultPreview.results}
                    placement={resultPreview.placement}
                  />
                )}
                {addingResults && projectId !== undefined ? (
                  <DockCard section="display" order={4}>
                    <AddResultSet
                      projectId={projectId}
                      slideId={slideId}
                      onClose={closeAddResults}
                      onPreview={setResultPreview}
                    />
                  </DockCard>
                ) : null}
                {annotateTask ? (
                  <AnnotateTaskPanel
                    engine={session.engine}
                    stage={hostNode}
                    task={annotateTask}
                    classes={classes}
                    saveState={saved.saveState}
                    colourOf={colourOf}
                    onOpenSlide={onOpenSlide}
                  />
                ) : null}
                {workspace === "annotate" || tool !== restingTool || proposalCount > 0 ? (
                  <ContextBarView
                    model={contextModel}
                    classes={classes}
                    activeClass={activeClass}
                    onPick={pickClassKey}
                    proposals={
                      proposalCount > 0
                        ? {
                            count: proposalCount,
                            activeName: activeInfo?.name ?? null,
                            onAccept: acceptProposals,
                            onDiscard: discardProposals,
                          }
                        : null
                    }
                  />
                ) : null}
                {toolsLayout === "dock" ? (
                  <div
                    data-slot="stage-tools"
                    className="absolute bottom-3.5 left-1/2 z-6 flex -translate-x-1/2 rounded-zone border border-line bg-chrome p-1.25 shadow-pop"
                  >
                    {setup.rail.map((group) => (
                      <div
                        key={group.map((item) => item.tool).join("-")}
                        className="flex border-r border-line px-1 last:border-r-0"
                      >
                        {group.map(railButtons)}
                      </div>
                    ))}
                    <div className="flex px-1">{panelButton}</div>
                  </div>
                ) : null}
                <DockCard section="display" order={1}>
                  {workspace === "annotate" ? (
                    <LayersPanel
                      document={annotations}
                      onApply={saved.apply}
                      classes={classes}
                      areas={areas}
                      target={saved.target}
                      onTarget={saved.setTarget}
                      resultSets={
                        projectId === undefined ? undefined : (
                          <ResultSetLayers
                            slideId={slideId}
                            adding={addingResults}
                            onAdd={() => setAddingResults(true)}
                            heatmaps={heatmapChoices}
                          />
                        )
                      }
                    />
                  ) : null}
                </DockCard>
                <DockCard section="objects" order={3}>
                  {showsCountPanel(setup, {
                    counting: tool === "marker",
                    markers: markerTotal,
                  }) ? (
                    <CountPanel
                      document={annotations}
                      classes={classes}
                      activeClass={activeClass}
                      onPick={setActiveClass}
                    />
                  ) : null}
                </DockCard>
                <DockCard section="objects" order={4}>
                  <MeasurementList
                    document={annotations}
                    micronsPerPixel={session.engine.getSlide()?.micronsPerPixel ?? null}
                    onRemove={(id) =>
                      saved.apply(deleteShapes(annotations, [id]).document, t`Delete shape`)
                    }
                  />
                  {annotations.shapes.size > 0 ? (
                    <Button
                      size="sm"
                      data-testid="clear-annotations"
                      onClick={() => {
                        const count = annotations.shapes.size;
                        if (needsClearConfirmation(count) && !window.confirm(clearPrompt(count)))
                          return;
                        saved.apply(clearAll(annotations).document, t`Clear all`);
                      }}
                    >
                      <Trans>Clear all</Trans>
                    </Button>
                  ) : null}
                </DockCard>
              </>
            ) : null}
            {session && coverage && viewed?.peek ? (
              <ViewedPeek
                engine={session.engine}
                raster={coverage.raster}
                tissue={coverage.tissue}
                percent={coverage.percent}
                onClose={viewed.onPeekClose}
              />
            ) : null}
            {session && outlines ? (
              <>
                <OutlineLayer
                  engine={session.engine}
                  module={session.module}
                  mode={outlineMode}
                  tissue={coverage?.tissue ?? null}
                />
                {taskId === undefined ? null : (
                  <ObjectDrawLayer
                    engine={session.engine}
                    module={session.module}
                    taskId={taskId}
                    tissue={coverage?.tissue ?? null}
                  />
                )}
                <DockCard section="display" order={0}>
                  <SegmentedControl
                    aria-label={t`Outline display`}
                    value={outlineMode}
                    onValueChange={(next) => setOutlineMode(next as OutlineModeChoice)}
                    options={outlineModeChoices.map((choice) => ({
                      value: choice,
                      label: outlineModeLabels[choice],
                    }))}
                  />
                </DockCard>
              </>
            ) : null}
            {session ? (
              <ViewerKeys
                session={session}
                selection={() =>
                  zoomTargetArea(annotations.shapes, selectedIds, focusedArea.current)
                }
              />
            ) : null}
            {session ? (
              <AreaKeys session={session} areas={areas} host={hostNode} focused={focusedArea} />
            ) : null}
            {session && hostNode && systematicScan ? (
              <ScanKeys session={session} host={hostNode} tissue={coverage?.tissue ?? null} />
            ) : null}
            {session ? (
              <div
                data-slot="stage-magnification"
                className="absolute bottom-4 left-1/2 -translate-x-1/2"
              >
                <MagnificationControl
                  engine={session.engine}
                  units={session.module}
                  brightness={brightness}
                  onBrightnessChange={setBrightness}
                  labelAs={magnificationLabel}
                />
              </div>
            ) : null}
            {phase.state === "loading" ? (
              <div className="absolute top-4 left-4">
                <Loader label={t`Loading the slide`} size="inline" />
              </div>
            ) : null}
            {chosenDevice === undefined ? null : (
              <DockCard section="display" order={9}>
                <DeviceLegend
                  device={legendDeviceOf(chosenDevice)}
                  context={workspace === "annotate" ? "annotate" : "review"}
                />
              </DockCard>
            )}
            {phase.state === "loading" ? null : (
              <SaveStatus state={saved.saveState} unsaved={saved.unsaved} />
            )}
            <LiveChangesMarker changes={saved.incoming} onShow={saved.showIncoming} />
            <ConflictNotice conflicts={saved.conflicts} onResolve={saved.resolveConflict} />
            {phase.state === "failed" ? (
              <div className="absolute top-4 left-1/2 w-[min(760px,calc(100%-2rem))] -translate-x-1/2">
                <InlineState
                  icon="warn"
                  title={phase.failure.title}
                  role="alert"
                  className="border-solid shadow-pop"
                  action={
                    <Button size="lg" onClick={onRetry}>
                      <Trans>Try again</Trans>
                    </Button>
                  }
                >
                  {phase.failure.detail}
                </InlineState>
              </div>
            ) : null}
          </div>
          <StageInspector
            key={workspace}
            layout={inspectorLayout}
            onLayout={setInspectorLayout}
            initialTab={initialTab}
            onSlot={placeSlot}
          />
        </div>
      </InspectorSlotsProvider>
    </EscProvider>
  );
}
