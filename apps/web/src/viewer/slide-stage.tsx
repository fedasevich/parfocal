import { getTileAccess } from "@parfocal/api-client";
import { AreaList } from "@parfocal/ui/components/analysis-cards";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { ToolRailButton } from "@parfocal/ui/components/tool-rail-button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { removeShape } from "../annotations/document.ts";
import { FreehandLayer } from "../annotations/freehand-layer.tsx";
import { PolygonLayer } from "../annotations/polygon-layer.tsx";
import { SelectLayer } from "../annotations/select-layer.tsx";
import { useSavedAnnotations } from "../annotations/use-saved-annotations.ts";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { MeasurementList } from "../measure/measurement-list.tsx";
import { RulerLayer } from "../measure/ruler-layer.tsx";
import { areaRoleText, areaRows } from "../screens/viewer/area-nav.ts";
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

type ViewerTool = "hand" | "ruler" | "select" | "polygon" | "freehand";

const toolOfAction: Readonly<Record<string, ViewerTool>> = {
  tselect: "select",
  truler: "ruler",
  tpoly: "polygon",
  tfree: "freehand",
};

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
  areas = [],
  viewed,
  systematicScan = false,
  outlines = false,
}: {
  slideId: string;
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
  areas,
  viewed,
  systematicScan,
  outlines,
  onRetry,
}: {
  slideId: string;
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
  const toolBindings = useBindings(["annotate"], ["truler", "tselect", "tpoly", "tfree"]);
  const onToolKey = useCallback(({ phase, action }: { phase: string; action: string }) => {
    const pressed = toolOfAction[action];
    if (phase !== "press" || pressed === undefined) return;
    setTool((current) => (current === pressed ? "hand" : pressed));
  }, []);
  useHotkeys(toolBindings, onToolKey);
  const leaveTool = useCallback(() => setTool("hand"), []);
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const [session, setSession] = useState<Session | null>(null);
  const [brightness, setBrightness] = useSlideBrightness();
  const [outlineMode, setOutlineMode] = useOutlineMode();
  const saved = useSavedAnnotations(slideId, session !== null);
  const annotations = saved.document;
  const setAnnotations = saved.setDocument;
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
      className="relative size-full min-h-0 bg-chrome data-[tool=polygon]:**:cursor-crosshair! data-[tool=freehand]:**:cursor-crosshair! data-[tool=ruler]:**:cursor-crosshair!"
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
          <SelectLayer
            engine={session.engine}
            stage={hostNode}
            active={tool === "select"}
            document={annotations}
            onDocumentChange={setAnnotations}
            onLeave={leaveTool}
          />
          <div className="absolute top-4 left-4 flex flex-col rounded-ctl border border-line bg-chrome">
            <ToolRailButton
              icon="select"
              label="Select"
              action="tselect"
              pressed={tool === "select"}
              onPressedChange={(on) => setTool(on ? "select" : "hand")}
            />
            <ToolRailButton
              icon="poly"
              label="Polygon"
              action="tpoly"
              pressed={tool === "polygon"}
              onPressedChange={(on) => setTool(on ? "polygon" : "hand")}
            />
            <ToolRailButton
              icon="free"
              label="Freehand"
              action="tfree"
              pressed={tool === "freehand"}
              onPressedChange={(on) => setTool(on ? "freehand" : "hand")}
            />
            <ToolRailButton
              icon="ruler"
              label="Ruler"
              action="truler"
              pressed={tool === "ruler"}
              onPressedChange={(on) => setTool(on ? "ruler" : "hand")}
            />
          </div>
          <div className="absolute right-4 bottom-4 w-72 max-w-[calc(100%-2rem)]">
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
