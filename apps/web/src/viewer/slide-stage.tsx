import { getTileAccess } from "@parfocal/api-client";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { useEffect, useRef, useState } from "react";
import { loadViewerEngine } from "./load-engine.ts";
import { describeOpenFailure, type OpenFailure } from "./open-failure.ts";

type Phase =
  | { readonly state: "loading" }
  | { readonly state: "ready" }
  | { readonly state: "failed"; readonly failure: OpenFailure };

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

export function SlideStage({ slideId }: { slideId: string }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <OpenedSlide key={attempt} slideId={slideId} onRetry={() => setAttempt((count) => count + 1)} />
  );
}

function OpenedSlide({ slideId, onRetry }: { slideId: string; onRetry: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ state: "loading" });

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    let disposed = false;
    let dispose: (() => void) | null = null;
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
          if (!disposed) setPhase({ state: "ready" });
        })
        .catch(fail);
    }, fail);
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [slideId]);

  return (
    <div
      data-testid="slide-stage"
      data-state={phase.state}
      className="relative size-full min-h-0 bg-chrome"
    >
      <div ref={host} className="absolute inset-0" />
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
