import { getTileAccess, listProjectClasses, type ProjectClass } from "@parfocal/api-client";
import { AreaList } from "@parfocal/ui/components/analysis-cards";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { ToolRailButton } from "@parfocal/ui/components/tool-rail-button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClassKeys } from "../annotations/class-keys.ts";
import { CountLayer } from "../annotations/count-layer.tsx";
import { markersOf } from "../annotations/count-markers.ts";
import { CountPanel } from "../annotations/count-panel.tsx";
import { removeShape } from "../annotations/document.ts";
import { DragLayer } from "../annotations/drag-layer.tsx";
import { FreehandLayer } from "../annotations/freehand-layer.tsx";
import { PolygonLayer } from "../annotations/polygon-layer.tsx";
import { SelectLayer } from "../annotations/select-layer.tsx";
import { useSavedAnnotations } from "../annotations/use-saved-annotations.ts";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { MeasurementList } from "../measure/measurement-list.tsx";
import { RulerLayer } from "../measure/ruler-layer.tsx";
import { areaRoleText, areaRows } from "../screens/viewer/area-nav.ts";
import { annotateRail } from "../screens/viewer-tools/rails.ts";
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
import type { ScanTissue } from "./tissue-scan.ts";
import { useEngineAreaNav } from "./use-engine-area-nav.ts";
import { useTissueScan } from "./use-tissue-scan.ts";
import { useViewerKeys } from "./use-viewer-keys.ts";
import { ViewedPeek } from "./viewed-peek.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";

type Phase =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly fittedMs: number }
  | { readonly state: "failed"; readonly failure: OpenFailure };

type ViewerTool = string;

const liveTools = new Set([
  "ruler",
  "select",
  "polygon",
  "freehand",
  "rectangle",
  "ellipse",
  "marker",
]);

const toolOfAction: Readonly<Record<string, ViewerTool>> = Object.fromEntries(
  annotateRail
    .flat()
    .flatMap((item) => (item.action === undefined ? [] : [[item.action, item.tool]])),
);

const railActions = annotateRail.flatMap((group) =>
  group.flatMap((item) => (item.action === undefined ? [] : [item.action])),
);

const toolNameOfRail: Readonly<Record<string, ViewerTool>> = {
  poly: "polygon",
  free: "freehand",
  rect: "rectangle",
  marker: "marker",
  ellipse: "ellipse",
};

const stageToolOf = (railTool: string): ViewerTool => toolNameOfRail[railTool] ?? railTool;

type Session = { readonly engine: ViewerEngine; readonly module: ViewerModule };

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

function AreaKeys({ session, areas }: { session: Session; areas: readonly SlideAreaEntry[] }) {
  const nav = useEngineAreaNav(session.engine, session.module, areas);
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
  return (
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
  areas = [],
  viewed,
  systematicScan = false,
  outlines = false,
}: {
  slideId: string;
  projectId?: string;
  areas?: readonly SlideAreaEntry[];
  viewed?: ViewedLink;
  systematicScan?: boolean;
  outlines?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <OpenedSlide
      key={attempt}
      slideId={slideId}
      projectId={projectId}
      areas={areas}
      viewed={viewed}
      systematicScan={systematicScan}
      outlines={outlines}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}

function OpenedSlide({
  slideId,
  projectId,
  areas,
  viewed,
  systematicScan,
  outlines,
  onRetry,
}: {
  slideId: string;
  projectId: string | undefined;
  areas: readonly SlideAreaEntry[];
  viewed: ViewedLink | undefined;
  systematicScan: boolean;
  outlines: boolean;
  onRetry: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [hostNode, setHostNode] = useState<HTMLDivElement | null>(null);
  const hostRef = useCallback((node: HTMLDivElement | null) => {
    host.current = node;
    setHostNode(node);
  }, []);
  const [tool, setTool] = useState<ViewerTool>("hand");
  const toolBindings = useBindings(["annotate"], railActions);
  const onToolKey = useCallback(({ phase, action }: { phase: string; action: string }) => {
    const railTool = toolOfAction[action];
    if (phase !== "press" || railTool === undefined) return;
    const pressed = stageToolOf(railTool);
    if (pressed === "hand") {
      setTool("hand");
      return;
    }
    setTool((current) => (current === pressed ? "hand" : pressed));
  }, []);
  useHotkeys(toolBindings, onToolKey);
  const leaveTool = useCallback(() => setTool("hand"), []);
  const waiting = !liveTools.has(tool) && tool !== "hand";
  useEffect(() => {
    if (!waiting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTool("hand");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [waiting]);
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const [session, setSession] = useState<Session | null>(null);
  const [brightness, setBrightness] = useSlideBrightness();
  const [outlineMode, setOutlineMode] = useOutlineMode();
  const saved = useSavedAnnotations(slideId, session !== null);
  const annotations = saved.document;
  const setAnnotations = saved.setDocument;
  const [classes, setClasses] = useState<readonly ProjectClass[]>([]);
  const [activeClass, setActiveClass] = useState<string | null>(null);
  useEffect(() => {
    if (projectId === undefined) return;
    let cancelled = false;
    void listProjectClasses(projectId).then(
      (response) => {
        if (cancelled || response.status !== 200) return;
        const sorted = [...response.data].sort((a, b) => a.key - b.key);
        setClasses(sorted);
        setActiveClass((current) => current ?? sorted[0]?.id ?? null);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const pickSlot = useCallback(
    (slot: number) => {
      const picked = classes[slot - 1];
      if (picked !== undefined) setActiveClass(picked.id);
    },
    [classes],
  );
  useClassKeys(pickSlot, tool === "marker");
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
      const viewport = engine.mountSlideViewport({
        container,
        slideId,
        route: { onError: fail },
        resolve: async () => {
          const grant = await access.grant();
          return engine.signedOpenRequest({
            access: access.access,
            basePath: grant.basePath,
            original: grant.original,
            identifiedFormat: grant.format ?? null,
          });
        },
      });
      dispose = () => viewport.dispose();
      viewport.ready
        .then(() => viewport.route()?.whenIdle())
        .then(() => {
          if (disposed) return;
          setSession({ engine: viewport.engine, module: engine });
          setPhase({ state: "ready", fittedMs: performance.now() - startedAt });
        })
        .catch(fail);
    }, fail);
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [slideId]);

  useEffect(() => {
    session?.engine.setSlideBrightness(brightness);
  }, [session, brightness]);

  return (
    <div
      data-testid="slide-stage"
      data-state={phase.state}
      data-fitted-ms={phase.state === "ready" ? Math.round(phase.fittedMs) : undefined}
      data-tool={tool}
      data-annotations={saved.loaded ? "loaded" : "loading"}
      data-save-state={saved.saveState}
      data-coverage={coverage?.loaded ? "loaded" : "loading"}
      data-coverage-percent={coverage?.percent}
      data-coverage-seen={coverage?.share.seen}
      data-coverage-pending={coverage?.pending}
      data-coverage-basis={coverage?.share.basis}
      className="relative size-full min-h-0 bg-chrome data-[tool=polygon]:**:cursor-crosshair! data-[tool=freehand]:**:cursor-crosshair! data-[tool=rectangle]:**:cursor-crosshair! data-[tool=ellipse]:**:cursor-crosshair! data-[tool=marker]:**:cursor-crosshair! data-[tool=ruler]:**:cursor-crosshair!"
    >
      <div ref={hostRef} className="absolute inset-0" />
      {session && hostNode ? (
        <>
          <RulerLayer
            engine={session.engine}
            stage={hostNode}
            active={tool === "ruler"}
            document={annotations}
            onDocumentChange={setAnnotations}
            onLeave={leaveTool}
          />
          <PolygonLayer
            engine={session.engine}
            stage={hostNode}
            active={tool === "polygon"}
            document={annotations}
            onClose={saved.savePolygon}
            onLeave={leaveTool}
          />
          <FreehandLayer
            engine={session.engine}
            stage={hostNode}
            active={tool === "freehand"}
            onClose={saved.savePolygon}
            onLeave={leaveTool}
          />
          <DragLayer
            engine={session.engine}
            stage={hostNode}
            kind="rectangle"
            active={tool === "rectangle"}
            onClose={saved.savePolygon}
            onLeave={leaveTool}
          />
          <DragLayer
            engine={session.engine}
            stage={hostNode}
            kind="ellipse"
            active={tool === "ellipse"}
            onClose={saved.savePolygon}
            onLeave={leaveTool}
          />
          <CountLayer
            engine={session.engine}
            stage={hostNode}
            active={tool === "marker"}
            document={annotations}
            colourOf={colourOf}
            onDrop={dropAt}
            onRemove={saved.removeMarker}
            onLeave={leaveTool}
          />
          <SelectLayer
            engine={session.engine}
            stage={hostNode}
            active={tool === "select"}
            document={annotations}
            onDocumentChange={setAnnotations}
            onLeave={leaveTool}
          />
          <div className="absolute top-4 left-4 flex flex-col rounded-ctl border border-line bg-chrome">
            {annotateRail.map((group) => (
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
                      onPressedChange={(on) => setTool(on ? stageTool : "hand")}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="absolute right-4 bottom-4 grid w-72 max-w-[calc(100%-2rem)] gap-2">
            {tool === "marker" || markersOf(annotations).length > 0 ? (
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
              onRemove={(id) => setAnnotations(removeShape(annotations, id))}
            />
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
          <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-ctl border border-line bg-chrome p-1">
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
      {session ? <AreaKeys session={session} areas={areas} /> : null}
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
      {saved.saveState === "failed" ? (
        <p role="alert" className="absolute top-4 right-4 text-bad text-body-sm">
          The polygon was not saved
        </p>
      ) : null}
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
  );
}
