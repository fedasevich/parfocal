import { Trans, useLingui } from "@lingui/react/macro";
import { useAddReviewObject } from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { polygonToGeoJson } from "../../annotations/geojson.ts";
import { closeDraft, type Point, type PolygonDraft } from "../../annotations/polygon-draft.ts";
import { showUndoToast } from "../../shell/undo-toasts.tsx";
import { imageOfKind, stillToSlide } from "./outline-coords.ts";
import { RedrawLayer } from "./redraw-layer.tsx";
import type { ReviewSession } from "./review-data.ts";
import type { Camera } from "./slide-still.tsx";

export type MissedShape = { code: string; shape: PolygonDraft };

export function useMissedDraw(session: ReviewSession) {
  const { t } = useLingui();
  const [draft, setDraft] = useState<PolygonDraft | null>(null);
  const [saved, setSaved] = useState<MissedShape[]>([]);
  const queryClient = useQueryClient();
  const adder = useAddReviewObject({
    mutation: { onSuccess: () => void queryClient.invalidateQueries() },
  });
  const notSaved = () => showUndoToast({ message: t`The object was not saved. Draw it again.` });
  const finish = (kind: "region" | "cell") => {
    if (draft === null) return;
    const closed = closeDraft(draft.map((point) => stillToSlide(point, imageOfKind(kind))));
    if (closed.kind !== "closed") return;
    const shape = draft;
    setDraft(null);
    adder.mutate(
      {
        taskId: session.taskId,
        slideId: session.slideId,
        data: { kind, geometry: polygonToGeoJson(closed.points) },
      },
      {
        onSuccess: (response) => {
          if (response.status !== 201) return notSaved();
          const code = response.data.code ?? "";
          setSaved((now) => [...now, { code, shape }]);
          showUndoToast({ message: t`${code} saved as your own object.` });
        },
        onError: notSaved,
      },
    );
  };
  return {
    draft,
    saved,
    on: session.task?.display.add_missed !== false,
    start: () => setDraft([]),
    set: setDraft,
    stop: () => setDraft(null),
    finish,
  };
}

export function useOutlineDrafts(session: ReviewSession) {
  const [redraw, setRedraw] = useState<PolygonDraft | null>(null);
  const missed = useMissedDraw(session);
  const drafting = redraw ?? missed.draft;
  return {
    redraw,
    setRedraw,
    missed,
    drafting,
    startRedraw: () => {
      missed.stop();
      setRedraw([]);
    },
    startMissed: () => {
      setRedraw(null);
      missed.start();
    },
    cancel: () => {
      setRedraw(null);
      missed.stop();
    },
    pickPoint: (point: Point) => {
      if (drafting === null) return;
      const last = drafting.at(-1);
      if (last?.x === point.x && last.y === point.y) return;
      if (redraw === null) missed.set([...drafting, point]);
      else setRedraw([...drafting, point]);
    },
  };
}

export function MissedOutlines({
  camera,
  size,
  saved,
}: {
  camera: Camera;
  size: { width: number; height: number };
  saved: MissedShape[];
}) {
  return saved.map((item) => (
    <RedrawLayer
      key={item.code}
      camera={camera}
      size={size}
      draft={null}
      saved={item.shape}
      onClose={() => undefined}
    />
  ));
}

export function AddedList({ added }: { added: string[] }) {
  if (added.length === 0) return null;
  const codes = added.join(", ");
  return (
    <p className="m-0 text-body-sm text-fg-dim" data-testid="added-objects">
      <Trans>You added {codes}</Trans>
    </p>
  );
}
