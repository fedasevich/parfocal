import { type Thread, useListThreads, useListThreadsOnSlide } from "@parfocal/api-client";
import { CommentComposer } from "@parfocal/ui/components/comment-thread";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import { markTried } from "../screens/home/getting-started.ts";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { pinThread } from "../screens/review/comment-pin.ts";
import { useMentionable } from "../screens/review/use-mentionable.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { bindClickPress, clickSlopScreenPixels } from "./click-press.ts";
import type { AnnotationDocument } from "./document.ts";
import type { PinRegistry } from "./pin-registry.ts";
import { removalDetail, removalTitle } from "./pin-removal.ts";
import { PinThread } from "./pin-thread.tsx";
import { dropPin, movePin, pinHitScreenPixels, pinPoint, placePin, pointOfAnchor } from "./pins.ts";
import type { Point } from "./polygon-draft.ts";
import { useStageRect } from "./stage-size.ts";
import {
  homeOf,
  moveThreadPin,
  removeThread,
  startThread,
  type ThreadHome,
  threadListKey,
} from "./thread-home.ts";
import { popoverSpot } from "./thread-popover.ts";

type PinLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  selecting?: boolean;
  registry?: PinRegistry;
  document: AnnotationDocument;
  projectId?: string | undefined;
  taskId: string | undefined;
  slideId: string;
  micronsPerPixel: number | null;
  onDocumentChange: (next: AnnotationDocument) => void;
  onCommit: (before: AnnotationDocument, after: AnnotationDocument, label: string) => void;
};

const onPinOrThread = (event: Event) =>
  event.target instanceof Element &&
  event.target.closest('[data-slot="comment-pin"], [data-testid="pin-thread"]') !== null;

const noPlaceReason = "Open the slide from its project to comment on it";

type Removal = { threadIds: readonly string[]; proceed: () => void };

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
  selecting = false,
  registry,
  document: doc,
  projectId,
  taskId,
  slideId,
  micronsPerPixel,
  onDocumentChange,
  onCommit,
}: PinLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const people = usePeople();
  const members = useMentionable();
  const queryClient = useQueryClient();
  const listed = useListThreads(taskId ?? "", slideId, undefined, {
    query: { enabled: taskId !== undefined },
  });
  const onSlide = useListThreadsOnSlide(projectId ?? "", slideId, undefined, {
    query: { enabled: projectId !== undefined },
  });
  const threads: Thread[] = [
    ...(taskId === undefined ? [] : (okData(listed.data) ?? [])),
    ...(projectId === undefined ? [] : (okData(onSlide.data) ?? [])),
  ];
  const startHome: ThreadHome | null =
    taskId !== undefined || projectId !== undefined
      ? { projectId: projectId ?? "", slideId, taskId: taskId ?? null }
      : null;
  const refreshList = (home: ThreadHome) =>
    void queryClient.invalidateQueries({ queryKey: threadListKey(home) });
  const [draft, setDraft] = useState<Point | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const latest = useRef({ doc, engine, onDocumentChange, onCommit, draft, drag, openId });
  latest.current = { doc, engine, onDocumentChange, onCommit, draft, drag, openId };
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removalFailed, setRemovalFailed] = useState(false);
  const move = useMutation({
    mutationFn: ({ thread, point }: { thread: Thread; point: Point }) =>
      moveThreadPin(homeOf(thread), thread.id, {
        geometry: { type: "Point", coordinates: [point.x, point.y] },
      }),
    onSuccess: (_, { thread }) => refreshList(homeOf(thread)),
  });
  const sentPoints = useRef(new Map<string, string>());
  const closeThread = useCallback(() => setOpenId(null), []);
  const create = useMutation({
    mutationFn: ({ home, data }: { home: ThreadHome; data: Parameters<typeof startThread>[1] }) =>
      startThread(home, data),
  });
  const dragStart = useRef<{ from: Point; grab: Point } | null>(null);

  useEffect(() => {
    if (!active) setDraft(null);
  }, [active]);

  const escRegistry = useEscRegistry();
  useEffect(
    () =>
      escRegistry?.add("comment", {
        open: () => latest.current.openId !== null || latest.current.draft !== null,
        peel: () => {
          if (latest.current.openId !== null) setOpenId(null);
          else setDraft(null);
        },
      }),
    [escRegistry],
  );

  useEffect(() => {
    if (!active) return;
    return bindClickPress(stage, {
      engine: () => latest.current.engine,
      ignore: onPinOrThread,
      onClick: (event) => {
        const current = latest.current.engine.getCamera();
        setDraft(
          screenToSlide(current, stage.getBoundingClientRect(), event.clientX, event.clientY),
        );
      },
    });
  }, [active, stage]);

  const draftAt = draft ? slideToScreen(camera, rect, draft) : null;
  const toleranceNow = () => pinHitScreenPixels / 2 ** latest.current.engine.getCamera().zoom;

  const send = (text: string) => {
    const point = latest.current.draft;
    const data = point === null ? null : pinThread(point, text, members);
    if (point === null || data === null || startHome === null) return;
    const home = startHome;
    create.mutate(
      { home, data },
      {
        onSuccess: (response) => {
          if (response.status !== 201) return;
          markTried("comment");
          const { doc: before } = latest.current;
          latest.current.onDocumentChange(
            placePin(before, response.data.id, point, toleranceNow()),
          );
          refreshList(home);
          setDraft(null);
        },
      },
    );
  };

  const releaseDrag = (threadId: string) => {
    const { drag: current, doc: before } = latest.current;
    setDrag(null);
    dragStart.current = null;
    if (current === null) return;
    if (!current.moved) {
      setDraft(null);
      setOpenId((already) => (already === threadId ? null : threadId));
      return;
    }
    setOpenId(null);
    const after = movePin(before, threadId, current.point, toleranceNow());
    latest.current.onDocumentChange(after);
    latest.current.onCommit(before, after, "Move comment pin");
  };

  const confirmRemoval = async () => {
    if (removal === null) return;
    setRemoving(true);
    setRemovalFailed(false);
    const gone: string[] = [];
    for (const threadId of removal.threadIds) {
      try {
        const thread = threads.find((item) => item.id === threadId);
        if (thread === undefined) continue;
        const response = await removeThread(homeOf(thread), threadId);
        if (response.status === 204) gone.push(threadId);
      } catch {
        break;
      }
    }
    let next = latest.current.doc;
    for (const threadId of gone) next = dropPin(next, threadId);
    if (next !== latest.current.doc) latest.current.onDocumentChange(next);
    for (const thread of threads) refreshList(homeOf(thread));
    setRemoving(false);
    if (gone.length < removal.threadIds.length) {
      setRemovalFailed(true);
      return;
    }
    setOpenId(null);
    setRemoval(null);
    removal.proceed();
  };

  const pins = threads.flatMap((thread) => {
    if (thread.resolved_at !== null) return [];
    const dragged = drag?.threadId === thread.id ? drag.point : null;
    const point = dragged ?? pinPoint(doc, thread.id, pointOfAnchor(thread.anchor));
    return point === null ? [] : [{ thread, point }];
  });

  const anchors = new Map<string, Point>();
  for (const { thread, point } of pins) {
    if (thread.anchor.kind === "point") anchors.set(thread.id, point);
  }
  const serverPoints = new Map<string, Point>();
  for (const thread of threads) {
    const saved = pointOfAnchor(thread.anchor);
    if (saved !== null && thread.resolved_at === null) serverPoints.set(thread.id, saved);
  }

  if (registry) {
    registry.anchors = serverPoints;
    registry.open = (threadId) => {
      setDraft(null);
      setOpenId(threadId);
    };
    registry.remove = (threadIds, proceed) => {
      setRemovalFailed(false);
      setRemoval({ threadIds, proceed });
    };
  }

  const settledKey = pins
    .map(({ thread, point }) => `${thread.id}:${point.x},${point.y}`)
    .join("|");
  const syncMoves = useRef<() => void>(() => undefined);
  syncMoves.current = () => {
    if (drag !== null) return;
    for (const [threadId, point] of anchors) {
      const saved = serverPoints.get(threadId);
      if (saved === undefined) continue;
      const key = `${point.x},${point.y}`;
      if (Math.abs(saved.x - point.x) < 1e-6 && Math.abs(saved.y - point.y) < 1e-6) {
        sentPoints.current.delete(threadId);
        continue;
      }
      if (sentPoints.current.get(threadId) === key) continue;
      sentPoints.current.set(threadId, key);
      const thread = threads.find((item) => item.id === threadId);
      if (thread !== undefined) move.mutate({ thread, point });
    }
  };
  useEffect(() => {
    if (settledKey === "" && drag !== null) return;
    const timer = window.setTimeout(() => syncMoves.current(), 250);
    return () => window.clearTimeout(timer);
  }, [settledKey, drag]);

  const opened = pins.find(({ thread }) => thread.id === openId);
  const openedAt = opened ? slideToScreen(camera, rect, opened.point) : null;

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
            aria-label={`${author?.initials ?? "?"}, comment by ${author?.name ?? "someone"}: ${thread.title}`}
            title={thread.title}
            className={`${selecting ? "pointer-events-none" : "pointer-events-auto"} absolute grid size-7 -translate-y-full cursor-grab place-items-center rounded-full rounded-bl-none border-0 bg-accent-fill p-0 font-semibold text-caption text-on-accent shadow-md active:cursor-grabbing`}
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
      {opened && openedAt ? (
        <PinThread
          key={opened.thread.id}
          thread={opened.thread}
          document={doc}
          micronsPerPixel={micronsPerPixel}
          spot={popoverSpot(openedAt, { width: rect.width, height: rect.height })}
          onClose={closeThread}
        />
      ) : null}
      <SmallModal
        open={removal !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoval(null);
        }}
        title={removalTitle(removal?.threadIds.length ?? 0)}
        subtitle={removalDetail(removal?.threadIds ?? [], threads)}
        primaryLabel="Delete"
        primaryBusy={removing}
        onPrimary={() => void confirmRemoval()}
        onCancel={() => setRemoval(null)}
      >
        {removalFailed ? (
          <p role="alert" className="m-0 text-body-sm text-bad">
            Some threads could not be deleted. Only the person who started a thread or a project
            owner deletes it.
          </p>
        ) : null}
      </SmallModal>
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
            offReason={startHome === null ? noPlaceReason : undefined}
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
