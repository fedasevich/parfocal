import { getTileAccess, listProjectClasses, type ProjectClass } from "@parfocal/api-client";
import { AreaList } from "@parfocal/ui/components/analysis-cards";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { ToolRailButton } from "@parfocal/ui/components/tool-rail-button";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadSmartServices,
  type SmartServicesContext,
  shareServices,
} from "../aiseg/smart-services.ts";
import { type AnnotateTask, taskClassesOf } from "../annotations/annotate-task.ts";
import { ArrowLayer } from "../annotations/arrow-layer.tsx";
import { AutoLayer } from "../annotations/auto-layer.tsx";
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
import { PinLayer } from "../annotations/pin-layer.tsx";
import { createPinRegistry } from "../annotations/pin-registry.ts";
import { type DraftControl, PolygonLayer } from "../annotations/polygon-layer.tsx";
import { ProposalLayer } from "../annotations/proposal-layer.tsx";
import { SaveStatus } from "../annotations/save-status.tsx";
import { SelectLayer } from "../annotations/select-layer.tsx";
import { SmartLayer } from "../annotations/smart-layer.tsx";
import { type TextControl, TextLayer } from "../annotations/text-layer.tsx";
import { useProposals } from "../annotations/use-proposals.ts";
import { useSavedAnnotations } from "../annotations/use-saved-annotations.ts";
import { legendDeviceOf } from "../devices/device-legend.ts";
import { DeviceLegend } from "../devices/device-legend.tsx";
import { applyMainCalibration } from "../devices/stage-calibration.ts";
import { EscProvider, useEscOwner, useNewEscRegistry } from "../keys/esc-owner.tsx";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { MeasurementList } from "../measure/measurement-list.tsx";
import { RulerLayer } from "../measure/ruler-layer.tsx";
import { areaRoleText, areaRows } from "../screens/viewer/area-nav.ts";
import { annotateRail } from "../screens/viewer-tools/rails.ts";
import { useDeveloperMode } from "../shell/developer-mode.ts";
import { readDeviceSettings } from "../shell/device-settings.ts";
import { AnnotateTaskPanel } from "./annotate-task-panel.tsx";
import { followLabPrefetch, labRouteOptions } from "./lab-route.ts";
import { loadViewerEngine } from "./load-engine.ts";
import { MagnificationControl, type ViewerModule } from "./magnification-control.tsx";
import { describeOpenFailure, type OpenFailure } from "./open-failure.ts";
import { OutlineLayer } from "./outline-layer.tsx";
import {
  type OutlineModeChoice,
  outlineModeChoices,
  outlineModeLabels,
  useOutlineMode,
} from "./outline-mode.ts";
import type { SlideAreaEntry } from "./slide-areas.ts";
import { useSlideBrightness } from "./slide-brightness.ts";
import { useSlideCoverage } from "./slide-coverage.ts";
import { stageToolOf } from "./stage-tools.ts";
import { FailedTilePlaceholders, SlideChecker, TileHintChip } from "./tile-loading.tsx";
import type { ScanTissue } from "./tissue-scan.ts";
import { TravelMinimap } from "./travel-minimap.tsx";
import { useEngineAreaNav } from "./use-engine-area-nav.ts";
import { useTissueScan } from "./use-tissue-scan.ts";
import { useViewerKeys } from "./use-viewer-keys.ts";
import { ViewedPeek } from "./viewed-peek.tsx";
import type { ViewerEngine, VivRoute } from "./viewer-engine.ts";
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
};

type Grant = {
  readonly token: string;
  readonly lifetimeSeconds: number;
  readonly basePath: string;
  readonly original: string;
  readonly format: string | null;
};

async function grantFor(slideId: string, previous: string | null): Promise<Grant> {
  const response = await getTileAccess(
    slideId,
    previous === null ? undefined : { headers: { "Previous-Tile-Token": previous } },
  );
  if (response.status !== 200) throw new Error(`tile-access answered ${response.status}`);
  const access = response.data;
  return {
    token: access.token,
    lifetimeSeconds: access.lifetime_seconds,
    basePath: access.base_path,
    original: access.original,
    format: access.format,
  };
}

function ViewerKeys({ session }: { session: Session }) {
  useViewerKeys(session.engine, session.module);
  return null;
}

function AreaKeys({
  session,
  areas,
  host,
}: {
  session: Session;
  areas: readonly SlideAreaEntry[];
  host: HTMLElement | null;
}) {
  const nav = useEngineAreaNav(session.engine, session.module, areas, host);
  const rows = useMemo(() => areaRows(areas, () => undefined), [areas]);
  const roles = useMemo(
    () =>
      new Map(
        areaRows(areas, () => undefined).map((row) => [
          row.object,
          row.role ? areaRoleText[row.role] : undefined,
        ]),
      ),
    [areas],
  );
  if (areas.length === 0) return null;
  const targetRow = rows.find((row) => row.object === nav.travelling?.object);
  return (
    <>
      {nav.travelling ? (
        <TravelMinimap
          engine={session.engine}
          travel={nav.travelling}
          label={`area ${targetRow?.number ?? ""}`.trim()}
          host={host}
        />
      ) : null}
      <section
        aria-label="Areas"
        data-testid="area-nav"
        data-current={nav.current ?? ""}
        data-visited={[...nav.visited].sort().join(" ")}
        className="absolute top-4 right-4 grid w-[min(320px,calc(100%-6rem))] gap-2 rounded-ctl border border-line bg-chrome p-3"
      >
        <h2 className="m-0 font-semibold text-body-sm">Areas, largest first</h2>
        <AreaList
          areas={areas}
          current={nav.current}
          visited={nav.visited}
          roleOf={(object) => roles.get(object)}
          onGoTo={nav.goTo}
        />
      </section>
    </>
  );
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
}: {
  slideId: string;
  projectId?: string;
  taskId?: string;
  annotateTask?: AnnotateTask | null;
  layerKnown?: boolean;
  onOpenSlide?: (slideId: string) => void;
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
  onRetry,
}: {
  slideId: string;
  projectId: string | undefined;
  taskId: string | undefined;
  annotateTask: AnnotateTask | null;
  layerKnown: boolean;
  onOpenSlide: ((slideId: string) => void) | undefined;
  areas: readonly SlideAreaEntry[];
  viewed: ViewedLink | undefined;
  systematicScan: boolean;
  outlines: boolean;
  workspace: SlideWorkspace;
  onRetry: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [hostNode, setHostNode] = useState<HTMLDivElement | null>(null);
  const pinRegistry = useMemo(createPinRegistry, []);
  const sharedServices = useMemo(() => shareServices(loadSmartServices), []);
  const hostRef = useCallback((node: HTMLDivElement | null) => {
    host.current = node;
    setHostNode(node);
  }, []);
  const setup = workspaceSetups[workspace];
  const restingTool: ViewerTool = setup.restingTool;
  const [tool, setTool] = useState<ViewerTool>(restingTool);
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
  const chosenDevice = useMemo(() => readDeviceSettings().device, []);
  const [outlineMode, setOutlineMode] = useOutlineMode();
  const sharedTaskId = annotateTask?.taskId ?? null;
  const snapshot = annotateTask?.classes ?? null;
  const saved = useSavedAnnotations(slideId, session !== null && layerKnown, sharedTaskId);
  const annotations = saved.document;
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
      const access = engine.createSlideAccess((previous) => grantFor(slideId, previous));
      const open = async () => {
        const grant = await access.grant();
        return engine.signedOpenRequest({
          access: access.access,
          basePath: grant.basePath,
          original: grant.original,
          identifiedFormat: grant.format ?? null,
        });
      };
      const viewport = engine.mountSlideViewport({
        container,
        slideId,
        route: { onError: fail, onTileError: () => {}, ...labRouteOptions() },
        resolve: open,
      });
      applyMainCalibration(viewport.engine);
      let unfollow = () => {};
      dispose = () => {
        unfollow();
        viewport.dispose();
      };
      viewport.ready
        .then(() => {
          if (!disposed) setOpened({ engine: viewport.engine, route: viewport.route() });
          unfollow = followLabPrefetch(viewport.route());
          return viewport.route()?.whenIdle();
        })
        .then(() => {
          if (disposed) return;
          setSession({ engine: viewport.engine, module: engine, open, route: viewport.route() });
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
    if (session === null || hostNode === null) return;
    const mark = () => {
      const camera = session.engine.getCamera();
      hostNode.dataset["camera"] =
        `${camera.x.toFixed(3)},${camera.y.toFixed(3)},${camera.zoom.toFixed(4)}`;
    };
    mark();
    return session.engine.subscribeCamera(mark);
  }, [session, hostNode]);

  useEffect(() => {
    session?.engine.setSlideBrightness(brightness);
  }, [session, brightness]);

  return (
    <EscProvider value={escRegistry}>
      <div
        data-testid="slide-stage"
        data-state={phase.state}
        data-fitted-ms={phase.state === "ready" ? Math.round(phase.fittedMs) : undefined}
        data-tool={tool}
        data-workspace={workspace}
        data-layer={sharedTaskId === null ? "slide" : "shared"}
        data-drag={setup.dragBehaviour}
        data-annotations={saved.loaded ? "loaded" : "loading"}
        data-save-state={saved.saveState}
        data-coverage={coverage?.loaded ? "loaded" : "loading"}
        data-coverage-percent={coverage?.percent}
        data-coverage-seen={coverage?.share.seen}
        data-coverage-pending={coverage?.pending}
        data-coverage-basis={coverage?.share.basis}
        className="relative size-full min-h-0 bg-chrome data-[tool=polygon]:**:cursor-crosshair! data-[tool=freehand]:**:cursor-crosshair! data-[tool=rectangle]:**:cursor-crosshair! data-[tool=ellipse]:**:cursor-crosshair! data-[tool=marker]:**:cursor-crosshair! data-[tool=arrow]:**:cursor-crosshair! data-[tool=text]:**:cursor-text! data-[tool=ruler]:**:cursor-crosshair! data-[tool=comment]:**:cursor-crosshair! data-[tool=smart]:**:cursor-crosshair! data-[tool=auto]:**:cursor-crosshair!"
      >
        {opened && hostNode ? <SlideChecker engine={opened.engine} stage={hostNode} /> : null}
        <div ref={hostRef} data-testid="slide-host" className="absolute inset-0" />
        {opened?.route && hostNode ? (
          <FailedTilePlaceholders engine={opened.engine} route={opened.route} stage={hostNode} />
        ) : null}
        {phase.state === "failed" ? null : <TileHintChip route={opened?.route ?? null} />}
        {session && developerMode ? (
          <Suspense fallback={null}>
            <LabLayer engine={session.engine} route={session.route} />
          </Suspense>
        ) : null}
        {session && hostNode ? (
          <>
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
              pinRegistry={pinRegistry}
            />
            <PinLayer
              engine={session.engine}
              stage={hostNode}
              active={tool === "comment"}
              selecting={tool === "select"}
              registry={pinRegistry}
              document={annotations}
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
              onDocumentChange={setAnnotations}
            />
            <ProposalLayer engine={session.engine} stage={hostNode} proposals={proposals.pending} />
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
            <div className="absolute top-4 left-4 flex flex-col rounded-ctl border border-line bg-chrome">
              {setup.rail.map((group) => (
                <div
                  key={group.map((item) => item.tool).join("-")}
                  className="flex flex-col border-b border-line last:border-b-0"
                >
                  {group.map((item) => {
                    const stageTool = stageToolOf(item.tool);
                    return (
                      <ToolRailButton
                        key={item.tool}
                        icon={item.icon}
                        label={item.label}
                        ai={item.ai ?? false}
                        {...(item.action === undefined ? {} : { action: item.action })}
                        data-tool={item.tool}
                        pressed={tool === stageTool}
                        onPressedChange={(on) => setTool(on ? stageTool : restingTool)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="absolute right-4 bottom-4 grid w-72 max-w-[calc(100%-2rem)] gap-2">
              {workspace === "annotate" ? (
                <LayersPanel
                  document={annotations}
                  onApply={saved.apply}
                  classes={classes}
                  areas={areas}
                  target={saved.target}
                  onTarget={saved.setTarget}
                />
              ) : null}
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
              <MeasurementList
                document={annotations}
                micronsPerPixel={session.engine.getSlide()?.micronsPerPixel ?? null}
                onRemove={(id) =>
                  saved.apply(deleteShapes(annotations, [id]).document, "Delete shape")
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
                    saved.apply(clearAll(annotations).document, "Clear all");
                  }}
                >
                  Clear all
                </Button>
              ) : null}
            </div>
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
            <div className="absolute top-16 left-1/2 -translate-x-1/2 rounded-ctl border border-line bg-chrome p-1">
              <SegmentedControl
                aria-label="Outline display"
                value={outlineMode}
                onValueChange={(next) => setOutlineMode(next as OutlineModeChoice)}
                options={outlineModeChoices.map((choice) => ({
                  value: choice,
                  label: outlineModeLabels[choice],
                }))}
              />
            </div>
          </>
        ) : null}
        {session ? <ViewerKeys session={session} /> : null}
        {session ? <AreaKeys session={session} areas={areas} host={hostNode} /> : null}
        {session && hostNode && systematicScan ? (
          <ScanKeys session={session} host={hostNode} tissue={coverage?.tissue ?? null} />
        ) : null}
        {session ? (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <MagnificationControl
              engine={session.engine}
              units={session.module}
              brightness={brightness}
              onBrightnessChange={setBrightness}
            />
          </div>
        ) : null}
        {phase.state === "loading" ? (
          <p role="status" className="absolute top-4 left-4 text-body-sm text-fg-dim">
            Loading the slide
          </p>
        ) : null}
        {chosenDevice === undefined ? null : (
          <DeviceLegend
            device={legendDeviceOf(chosenDevice)}
            context={workspace === "annotate" ? "annotate" : "review"}
          />
        )}
        {phase.state === "loading" ? null : (
          <SaveStatus state={saved.saveState} unsaved={saved.unsaved} />
        )}
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
                  Try again
                </Button>
              }
            >
              {phase.failure.detail}
            </InlineState>
          </div>
        ) : null}
      </div>
    </EscProvider>
  );
}
