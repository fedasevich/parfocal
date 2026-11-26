import { Trans, useLingui } from "@lingui/react/macro";
import { Icon } from "@parfocal/ui/components/icon";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useLocalToast } from "../screens/local-toast.tsx";
import { readDropped } from "../upload/drop.ts";
import { DockCard } from "../viewer/inspector-slots.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import type { DroppedFiles } from "./add-result-set.tsx";
import type { StagePreview } from "./file-preview.ts";

const AddResultSet = lazy(() =>
  import("./add-result-set.tsx").then((module) => ({ default: module.AddResultSet })),
);
const PreviewLayer = lazy(() =>
  import("./preview-layer.tsx").then((module) => ({ default: module.PreviewLayer })),
);

export type ResultAdding = {
  adding: boolean;
  dropped: DroppedFiles | null;
  over: boolean;
  open: () => void;
  close: () => void;
};

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true;

export function useResultAdding(stage: HTMLElement | null, enabled: boolean): ResultAdding {
  const [opened, setOpened] = useState<{ dropped: DroppedFiles | null } | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (stage === null || !enabled) return;
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(true);
    };
    const onLeave = (event: DragEvent) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !stage.contains(next)) setOver(false);
    };
    const onDrop = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      if (transfer === null || !carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(false);
      void readDropped(transfer).then((items) => {
        if (items.length > 0) setOpened({ dropped: { items, at: Date.now() } });
      });
    };
    stage.addEventListener("dragover", onOver);
    stage.addEventListener("dragleave", onLeave);
    stage.addEventListener("drop", onDrop);
    return () => {
      stage.removeEventListener("dragover", onOver);
      stage.removeEventListener("dragleave", onLeave);
      stage.removeEventListener("drop", onDrop);
    };
  }, [stage, enabled]);
  const open = useCallback(() => setOpened((current) => current ?? { dropped: null }), []);
  const close = useCallback(() => setOpened(null), []);
  return { adding: opened !== null, dropped: opened?.dropped ?? null, over, open, close };
}

export function StageResultAdding({
  engine,
  stage,
  projectId,
  slideId,
  adding,
}: {
  engine: ViewerEngine;
  stage: HTMLElement;
  projectId: string | undefined;
  slideId: string;
  adding: ResultAdding;
}) {
  const { t } = useLingui();
  const [preview, setPreview] = useState<StagePreview | null>(null);
  const toast = useLocalToast();
  const { close } = adding;
  const show = useRef(toast.show);
  show.current = toast.show;
  const onAdded = useCallback(
    (name: string) => {
      close();
      show.current(t`${name} added`);
    },
    [close, t],
  );
  return (
    <>
      {adding.over ? (
        <div
          data-testid="result-drop-overlay"
          className="pointer-events-none absolute inset-3 z-25 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--page)_55%,transparent)]"
        >
          <span className="grid max-w-96 justify-items-center gap-1.5 rounded-[14px] border border-line bg-chrome px-6 py-4 text-center shadow-pop">
            <Icon name="upload" size="lg" className="text-accent" />
            <b className="text-body text-fg">
              <Trans>Drop a result file to preview it on this slide</Trans>
            </b>
          </span>
        </div>
      ) : null}
      {preview === null ? null : (
        <Suspense fallback={null}>
          <PreviewLayer engine={engine} stage={stage} preview={preview} />
        </Suspense>
      )}
      {adding.adding && projectId !== undefined ? (
        <DockCard section="display" order={4}>
          <Suspense fallback={null}>
            <AddResultSet
              projectId={projectId}
              slideId={slideId}
              dropped={adding.dropped}
              onClose={close}
              onAdded={onAdded}
              onPreview={setPreview}
            />
          </Suspense>
        </DockCard>
      ) : null}
      {toast.node}
    </>
  );
}
