import {
  getListThreadsQueryKey,
  type Thread,
  useCreateThread,
  useListThreads,
} from "@parfocal/api-client";
import { CommentComposer } from "@parfocal/ui/components/comment-thread";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { pinThread } from "../screens/review/comment-pin.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import type { AnnotationDocument } from "./document.ts";
import { movePin, pinHitScreenPixels, pinPoint, placePin, pointOfAnchor } from "./pins.ts";
import type { Point } from "./polygon-draft.ts";

type PinLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  taskId: string | undefined;
  slideId: string;
  onDocumentChange: (next: AnnotationDocument) => void;
  onCommit: (before: AnnotationDocument, after: AnnotationDocument, label: string) => void;
  onLeave: () => void;
};

const clickSlopScreenPixels = 3;

const noTaskReason = "Open the slide from a task to comment on it";

type Drag = { threadId: string; point: Point; moved: boolean };

function Composer({
  at,
  offReason,
  failed,
  busy,
  onSend,
  onCancel,
}: {
  at: Point;
  offReason: string | undefined;
  failed: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const section = useRef<HTMLElement | null>(null);
  useEffect(() => {
    section.current?.querySelector("textarea")?.focus();
  }, []);
  return (
    <section
      ref={section}
      aria-label="New pinned thread"
      data-testid="pin-composer"
      className="pointer-events-auto absolute z-10 grid w-72 gap-2 rounded-ctl border border-line bg-chrome p-3 shadow-pop"
      style={{ left: at.x + 12, top: at.y + 12 }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <CommentComposer
        value={text}
        onValueChange={setText}
        onSend={() => {
          if (!busy) onSend(text);
        }}
        label="Comment at the pin"
        hint="Enter posts, Shift+Enter adds a line"
        offReason={offReason}
      />
      {failed ? (
        <p role="alert" className="m-0 text-body-sm text-bad">
          The thread did not save. Try again.
        </p>
      ) : null}
    </section>
  );
}

export function PinLayer({
  engine,
  stage,
  active,
  document: doc,
  taskId,
  slideId,
  onDocumentChange,
  onCommit,
  onLeave,
}: PinLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const people = usePeople();
  const queryClient = useQueryClient();
  const listed = useListThreads(taskId ?? "", slideId, undefined, {
    query: { enabled: taskId !== undefined },
  });
  const threads: Thread[] = okData(listed.data) ?? [];
  const [draft, setDraft] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef({ doc, engine, onDocumentChange, onCommit, onLeave, draft, drag });
  latest.current = { doc, engine, onDocumentChange, onCommit, onLeave, draft, drag };
  const create = useCreateThread();
  const dragStart = useRef<{ from: Point; grab: Point } | null>(null);

  useEffect(() => {
    if (!active) setDraft(null);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let pressed: { id: number; x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (pressed === null || event.pointerId !== pressed.id || event.button !== 0) return;
      const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
      pressed = null;
      if (moved > clickSlopScreenPixels) return;
      event.stopImmediatePropagation();
      const current = latest.current.engine.getCamera();
      setDraft(screenToSlide(current, stage.getBoundingClientRect(), event.clientX, event.clientY));
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (latest.current.draft !== null) setDraft(null);
      else latest.current.onLeave();
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key);
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key);
    };
  }, [active, stage]);

  const rect = { left: 0, top: 0, width: stage.clientWidth, height: stage.clientHeight };
  const draftAt = draft ? slideToScreen(camera, rect, draft) : null;
  const toleranceNow = () => pinHitScreenPixels / 2 ** latest.current.engine.getCamera().zoom;

  const send = (text: string) => {
    const point = latest.current.draft;
    const data = point === null ? null : pinThread(point, text);
    if (point === null || data === null || taskId === undefined) return;
    create.mutate(
      { taskId, slideId, data },
      {
        onSuccess: (response) => {
          if (response.status !== 201) return;
          const { doc: before } = latest.current;
          latest.current.onDocumentChange(
            placePin(before, response.data.id, point, toleranceNow()),
          );
          void queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey(taskId, slideId) });
          setDraft(null);
        },
      },
    );
  };

  const releaseDrag = (threadId: string) => {
    const { drag: current, doc: before } = latest.current;
    setDrag(null);
    dragStart.current = null;
    if (current === null || !current.moved) return;
    const after = movePin(before, threadId, current.point, toleranceNow());
    latest.current.onDocumentChange(after);
    latest.current.onCommit(before, after, "Move comment pin");
  };

  const pins = threads.flatMap((thread) => {
    if (thread.resolved_at !== null) return [];
    const dragged = drag?.threadId === thread.id ? drag.point : null;
    const point = dragged ?? pinPoint(doc, thread.id, pointOfAnchor(thread.anchor));
    return point === null ? [] : [{ thread, point }];
  });

  return (
    <div
      data-testid="pin-layer"
      data-pins={pins.length}
      data-placing={active ? "on" : "off"}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {pins.map(({ thread, point }) => {
        const at = slideToScreen(camera, rect, point);
        const author = people(thread.created_by);
        return (
          <button
            key={thread.id}
            type="button"
            data-slot="comment-pin"
            data-thread={thread.id}
            data-linked={doc.pins.get(thread.id)?.shapeId ?? ""}
            data-dragging={drag?.threadId === thread.id}
            aria-label={`Comment by ${author?.name ?? "someone"}: ${thread.title}`}
            title={thread.title}
            className="pointer-events-auto absolute grid size-7 -translate-y-full cursor-grab place-items-center rounded-full rounded-bl-none border-0 bg-accent-fill p-0 font-semibold text-caption text-on-accent shadow-md active:cursor-grabbing"
            style={{ left: at.x, top: at.y }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              const grabbed = screenToSlide(
                latest.current.engine.getCamera(),
                stage.getBoundingClientRect(),
                event.clientX,
                event.clientY,
              );
              dragStart.current = {
                from: { x: event.clientX, y: event.clientY },
                grab: { x: point.x - grabbed.x, y: point.y - grabbed.y },
              };
              setDrag({ threadId: thread.id, point, moved: false });
            }}
            onPointerMove={(event) => {
              const { drag: current } = latest.current;
              if (current === null || current.threadId !== thread.id) return;
              const start = dragStart.current;
              if (start === null) return;
              const away = Math.hypot(event.clientX - start.from.x, event.clientY - start.from.y);
              if (!current.moved && away <= clickSlopScreenPixels) return;
              const pointer = screenToSlide(
                latest.current.engine.getCamera(),
                stage.getBoundingClientRect(),
                event.clientX,
                event.clientY,
              );
              setDrag({
                threadId: thread.id,
                moved: true,
                point: { x: pointer.x + start.grab.x, y: pointer.y + start.grab.y },
              });
            }}
            onPointerUp={() => releaseDrag(thread.id)}
            onPointerCancel={() => setDrag(null)}
          >
            {author?.initials ?? "?"}
          </button>
        );
      })}
      {draft && draftAt ? (
        <>
          <span
            data-testid="pin-draft"
            aria-hidden
            className="absolute size-7 -translate-y-full rounded-full rounded-bl-none bg-accent-fill opacity-70"
            style={{ left: draftAt.x, top: draftAt.y }}
          />
          <Composer
            key={`${draft.x},${draft.y}`}
            at={draftAt}
            offReason={taskId === undefined ? noTaskReason : undefined}
            failed={create.isError}
            busy={create.isPending}
            onSend={send}
            onCancel={() => setDraft(null)}
          />
        </>
      ) : null}
    </div>
  );
}
