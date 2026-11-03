import { getTileAccess } from "@parfocal/api-client";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { ToolRailButton } from "@parfocal/ui/components/tool-rail-button";
import { useCallback, useEffect, useRef, useState } from "react";
import { createDocument } from "../annotations/document.ts";
import { SelectLayer } from "../annotations/select-layer.tsx";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import { RulerLayer } from "../measure/ruler-layer.tsx";
import { loadViewerEngine } from "./load-engine.ts";
import { MagnificationControl, type ViewerModule } from "./magnification-control.tsx";
import { describeOpenFailure, type OpenFailure } from "./open-failure.ts";
import { useSlideBrightness } from "./slide-brightness.ts";
import { useViewerKeys } from "./use-viewer-keys.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

type Phase =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly fittedMs: number }
  | { readonly state: "failed"; readonly failure: OpenFailure };

type ViewerTool = "hand" | "ruler" | "select";

type Session = { readonly engine: ViewerEngine; readonly module: ViewerModule };

type Grant = {
  readonly token: string;
  readonly lifetimeSeconds: number;
  readonly basePath: string;
  readonly original: string;
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
  };
}

function ViewerKeys({ session }: { session: Session }) {
  useViewerKeys(session.engine, session.module);
  return null;
}

export function SlideStage({ slideId }: { slideId: string }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <OpenedSlide key={attempt} slideId={slideId} onRetry={() => setAttempt((count) => count + 1)} />
  );
}

function OpenedSlide({ slideId, onRetry }: { slideId: string; onRetry: () => void }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [hostNode, setHostNode] = useState<HTMLDivElement | null>(null);
  const hostRef = useCallback((node: HTMLDivElement | null) => {
    host.current = node;
    setHostNode(node);
  }, []);
  const [tool, setTool] = useState<ViewerTool>("hand");
  const [annotations, setAnnotations] = useState(createDocument);
  const toolBindings = useBindings(["annotate"], ["truler", "tselect"]);
  const onToolKey = useCallback(({ phase, action }: { phase: string; action: string }) => {
    if (phase !== "press") return;
    const pressed = action === "tselect" ? "select" : "ruler";
    setTool((current) => (current === pressed ? "hand" : pressed));
  }, []);
  useHotkeys(toolBindings, onToolKey);
  const leaveTool = useCallback(() => setTool("hand"), []);
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const [session, setSession] = useState<Session | null>(null);
  const [brightness, setBrightness] = useSlideBrightness();

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
      className="relative size-full min-h-0 bg-chrome data-[tool=ruler]:**:cursor-crosshair!"
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
              icon="ruler"
              label="Ruler"
              action="truler"
              pressed={tool === "ruler"}
              onPressedChange={(on) => setTool(on ? "ruler" : "hand")}
            />
          </div>
        </>
      ) : null}
      {session ? <ViewerKeys session={session} /> : null}
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
