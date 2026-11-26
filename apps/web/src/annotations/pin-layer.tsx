import { Trans, useLingui } from "@lingui/react/macro";
import { type Thread, useListThreads, useListThreadsOnSlide } from "@parfocal/api-client";
import { SmallModal } from "@parfocal/ui/components/small-modal";
import { sameObjectId } from "@parfocal/ui/lib/object-id";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fingerPans } from "../devices/pen-touch.ts";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import { markTried } from "../screens/home/getting-started.ts";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { useMentionable } from "../screens/review/use-mentionable.ts";
import type { SlideAreaEntry } from "../viewer/slide-areas.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { type AnchorPlace, anchorArea, anchorCorner, anchorRowKey } from "./anchor-place.ts";
import { bindClickPress, clickSlopScreenPixels } from "./click-press.ts";
import { AnchorMarks, AnchorOutline, SelectionComment } from "./comment-anchors.tsx";
import {
  layerNames,
  onLayerComment,
  onRowThread,
  publishThreadCounts,
  useLayerNames,
} from "./comment-bus.ts";
import { publishReferences } from "./comment-references.ts";
import {
  areaOfExtent,
  type CommentDraft,
  type CommentTarget,
  regionTarget,
  targetExtent,
  targetOfShapes,
  targetThread,
} from "./comment-target.ts";
import type { AnnotationDocument } from "./document.ts";
import { useSavedCodes } from "./drawn-object-ids.ts";
import { pickShape } from "./hit-test.ts";
import { anchorReferences, drawnReferences } from "./pin-references.ts";
import type { PinRegistry } from "./pin-registry.ts";
import { removalDetail, removalTitle } from "./pin-removal.ts";
import { PinThread } from "./pin-thread.tsx";
import { dropPin, movePin, pinHitScreenPixels, pinPoint, placePin, pointOfAnchor } from "./pins.ts";
import type { Point } from "./polygon-draft.ts";
import {
  lookupResultAt,
  publishWantedResults,
  type ResultObject,
  resultAt,
  resultFor,
  ringExtent,
  useCurrentResult,
  useResultObjects,
} from "./result-objects.ts";
import type { ShapeId } from "./shapes.ts";
import { useStageRect } from "./stage-size.ts";
import { TargetComposer } from "./target-composer.tsx";
import {
  homeOf,
  moveThreadPin,
  removeThread,
  replyInThread,
  startThread,
  type ThreadHome,
  threadKey,
  threadListKey,
} from "./thread-home.ts";
import { popoverSpot } from "./thread-popover.ts";

type PinLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  selecting?: boolean;
  registry?: PinRegistry;
  areas?: readonly SlideAreaEntry[];
  selected?: readonly ShapeId[];
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
  event.target.closest(
    '[data-slot="comment-pin"], [data-slot="comment-anchor"], [data-testid="pin-thread"], [data-testid="pin-composer"], [data-testid="stage-menu"]',
  ) !== null;

const noPlaceReason = "Open the slide from its project to comment on it";

type Removal = { threadIds: readonly string[]; proceed: () => void };

type Drag = { threadId: string; point: Point; moved: boolean };

const noAreas: readonly SlideAreaEntry[] = [];
const noSelection: readonly ShapeId[] = [];

type Box = { from: Point; to: Point };

const openThreadOn = (threads: readonly Thread[], objectId: string, set?: string) =>
  threads.find(
    (thread) =>
      thread.resolved_at === null &&
      thread.anchor.object_id &&
      sameObjectId(thread.anchor.object_id, objectId) &&
      (set === undefined || !thread.anchor.result_set_id || thread.anchor.result_set_id === set),
  );

const resultTarget = (item: ResultObject): CommentTarget => ({
  kind: "object",
  objectId: item.id,
  shapes: [],
  extent: ringExtent(item.ring) ?? undefined,
  resultSet: item.set,
});

const unplacedObjects = (threads: readonly Thread[], results: readonly ResultObject[]) =>
  [
    ...new Set(
      threads.flatMap((thread) => {
        const id = thread.anchor.object_id;
        if (thread.resolved_at !== null || thread.anchor.kind !== "object" || !id) return [];
        return results.some((item) => sameObjectId(item.id, id)) ? [] : [id];
      }),
    ),
  ].sort();

export function PinLayer({
  engine,
  stage,
  active,
  selecting = false,
  registry,
  areas = noAreas,
  selected = noSelection,
  document: doc,
  projectId,
  taskId,
  slideId,
  micronsPerPixel,
  onDocumentChange,
  onCommit,
}: PinLayerProps) {
  const { t } = useLingui();
  const someone = t`someone`;
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
  const codes = useSavedCodes();
  const names = useLayerNames();
  const layerName = (key: string) => names.find((item) => item.key === key)?.name;
  const results = useResultObjects(slideId);
  const currentResult = useCurrentResult(slideId);
  const place: AnchorPlace = { doc, codes, areas, results };
  const currentItem = currentResult === null ? undefined : resultFor(results, areas, currentResult);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const now = {
    doc,
    engine,
    onDocumentChange,
    onCommit,
    draft,
    drag,
    openId,
    place,
    selected,
    threads,
    currentResult,
  };
  const latest = useRef(now);
  latest.current = now;
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
  const answer = useMutation({
    mutationFn: ({ thread, body }: { thread: Thread; body: string }) =>
      replyInThread(homeOf(thread), thread.id, { body }),
  });
  const dragStart = useRef<{ from: Point; grab: Point } | null>(null);

  const openTarget = useCallback((target: CommentTarget, clicked?: Point) => {
    const { doc: shown, place: where } = latest.current;
    const area =
      target.kind === "layer"
        ? anchorArea({ kind: "layer", layer: target.layer }, where)
        : areaOfExtent(targetExtent(shown, target));
    const at = clicked ?? (area === null ? null : { x: area.x + area.width, y: area.y });
    if (at === null) return;
    setOpenId(null);
    setDraft({ target, at, clicked });
  }, []);

  const commentOnResult = useCallback(
    (item: ResultObject, clicked?: Point) => {
      const existing = clicked
        ? undefined
        : openThreadOn(latest.current.threads, item.id, item.set);
      if (existing !== undefined) {
        setDraft(null);
        setOpenId(existing.id);
        return;
      }
      openTarget(resultTarget(item), clicked);
    },
    [openTarget],
  );

  const commentOnSelection = useCallback(() => {
    const { doc: shown, selected: picked, place: where, currentResult: chosen } = latest.current;
    const target = targetOfShapes(shown, where.codes, picked);
    if (target !== null) {
      openTarget(target);
      return;
    }
    const item = chosen === null ? undefined : resultFor(where.results ?? [], where.areas, chosen);
    if (item !== undefined) commentOnResult(item);
  }, [openTarget, commentOnResult]);

  useEffect(() => {
    if (!active) {
      setDraft((current) =>
        current?.target.kind === "point" || current?.target.kind === "region" ? null : current,
      );
      setBox(null);
      return;
    }
    if (latest.current.selected.length > 0 || latest.current.currentResult !== null) {
      commentOnSelection();
    }
  }, [active, commentOnSelection]);

  useEffect(
    () =>
      onLayerComment((key) => {
        const name = layerNames().find((item) => item.key === key)?.name ?? key;
        const area = anchorArea({ kind: "layer", layer: key }, latest.current.place);
        if (area !== null) void latest.current.engine.flyToArea(area);
        openTarget({ kind: "layer", layer: key, name });
      }),
    [openTarget],
  );

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
        const at = screenToSlide(
          current,
          stage.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        );
        const { doc: shown, place: where } = latest.current;
        const reach = pinHitScreenPixels / 2 ** current.zoom;
        const hit = pickShape(shown, at, reach);
        const target = hit === null ? null : targetOfShapes(shown, where.codes, [hit.id]);
        const result =
          target === null
            ? (resultAt(where.results ?? [], at, reach) ?? lookupResultAt(slideId, at, reach))
            : null;
        if (target !== null) openTarget(target, at);
        else if (result !== null) commentOnResult(result, at);
        else setDraft({ target: { kind: "point", at }, at });
      },
      onDrag: (from, event, done) => {
        const current = latest.current.engine.getCamera();
        const bounds = stage.getBoundingClientRect();
        const start = screenToSlide(current, bounds, from.clientX, from.clientY);
        const end = screenToSlide(current, bounds, event.clientX, event.clientY);
        if (!done) {
          setDraft(null);
          setBox({ from: start, to: end });
          return;
        }
        setBox(null);
        openTarget(regionTarget(start, end));
      },
    });
  }, [active, stage, slideId, openTarget, commentOnResult]);

  const draftAt = draft ? slideToScreen(camera, rect, draft.at) : null;
  const toleranceNow = () => pinHitScreenPixels / 2 ** latest.current.engine.getCamera().zoom;

  const send = (text: string) => {
    const current = latest.current.draft;
    const data = current === null ? null : targetThread(current.target, text, members);
    if (current === null || data === null || startHome === null) return;
    const on = current.target;
    const existing =
      on.kind === "object" && on.shapes.length === 0
        ? openThreadOn(threads, on.objectId, on.resultSet)
        : undefined;
    if (existing !== undefined) {
      answer.mutate(
        { thread: existing, body: data.body },
        {
          onSuccess: (response) => {
            if (response.status >= 300) return;
            refreshList(homeOf(existing));
            void queryClient.invalidateQueries({
              queryKey: threadKey(homeOf(existing), existing.id),
            });
            setDraft(null);
            setOpenId(existing.id);
          },
        },
      );
      return;
    }
    const point = current.target.kind === "point" ? current.target.at : null;
    const home = startHome;
    create.mutate(
      { home, data },
      {
        onSuccess: (response) => {
          if (response.status !== 201) return;
          markTried("comment");
          const { doc: before } = latest.current;
          if (point !== null) {
            latest.current.onDocumentChange(
              placePin(before, response.data.id, point, toleranceNow()),
            );
          }
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

  const marks = threads.flatMap((thread) => {
    if (thread.resolved_at !== null || thread.anchor.kind === "point") return [];
    const corner = anchorCorner(thread.anchor, place);
    return corner === null ? [] : [{ thread, point: corner }];
  });
  const rowCounts = new Map<string, number>();
  for (const { thread } of marks) {
    const key = anchorRowKey(thread.anchor, place);
    if (key !== null) rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
  }
  useEffect(() => publishThreadCounts(rowCounts));
  const rowThread = useRef<(key: string) => void>(() => undefined);
  rowThread.current = (key) => {
    const found = marks.find(({ thread }) => anchorRowKey(thread.anchor, place) === key);
    if (found === undefined) return;
    setDraft(null);
    setOpenId(found.thread.id);
  };
  useEffect(() => onRowThread((key) => rowThread.current(key)), []);
  useEffect(() => () => publishThreadCounts(new Map()), []);
  const unplaced = unplacedObjects(threads, results).join(",");
  useEffect(
    () => publishWantedResults(slideId, unplaced === "" ? [] : unplaced.split(",")),
    [slideId, unplaced],
  );
  useEffect(() => () => publishWantedResults(slideId, []), [slideId]);
  const referenceSource = `pins:${slideId}`;
  const drawn = useMemo(() => drawnReferences(doc, codes), [doc, codes]);
  useEffect(() => publishReferences(referenceSource, [...drawn, ...anchorReferences(threads)]));
  useEffect(() => () => publishReferences(referenceSource, []), [referenceSource]);

  const pinned = pins.find(({ thread }) => thread.id === openId);
  const unpinned =
    pinned || openId === null ? undefined : threads.find((item) => item.id === openId);
  const unpinnedAt = unpinned ? anchorCorner(unpinned.anchor, place) : null;
  const opened =
    pinned ?? (unpinned && unpinnedAt ? { thread: unpinned, point: unpinnedAt } : undefined);
  const openedAt = opened ? slideToScreen(camera, rect, opened.point) : null;
  const drafted =
    draft === null || draft.target.kind === "point"
      ? null
      : draft.target.kind === "layer"
        ? anchorArea({ kind: "layer", layer: draft.target.layer }, place)
        : areaOfExtent(targetExtent(doc, draft.target));
  const outlined =
    box !== null
      ? areaOfExtent(regionTarget(box.from, box.to).extent)
      : (drafted ?? (unpinned ? anchorArea(unpinned.anchor, place) : null));

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
            aria-label={t`${author?.initials ?? "?"}, comment by ${author?.name ?? someone}: ${thread.title}`}
            title={thread.title}
            className={`${selecting ? "pointer-events-none" : "pointer-events-auto"} absolute grid size-7 -translate-y-full cursor-grab place-items-center rounded-full rounded-bl-none border-0 bg-accent-fill p-0 font-semibold text-caption text-on-accent shadow-md active:cursor-grabbing`}
            style={{ left: at.x, top: at.y }}
            onPointerDown={(event) => {
              if (fingerPans(event) || event.button !== 0) return;
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
      <AnchorMarks
        marks={marks}
        camera={camera}
        rect={rect}
        selecting={selecting}
        layerName={layerName}
        initials={(thread) => people(thread.created_by)?.initials ?? "?"}
        onOpen={(threadId) => {
          setDraft(null);
          setOpenId((already) => (already === threadId ? null : threadId));
        }}
      />
      <AnchorOutline area={outlined} camera={camera} rect={rect} />
      {selecting ? (
        <SelectionComment
          stage={stage}
          count={selected.length > 0 ? selected.length : currentItem === undefined ? 0 : 1}
          label={
            selected.length === 0 && currentItem !== undefined
              ? t`Comment on ${currentResult}`
              : undefined
          }
          onComment={commentOnSelection}
        />
      ) : null}
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
        primaryLabel={t`Delete`}
        primaryBusy={removing}
        onPrimary={() => void confirmRemoval()}
        onCancel={() => setRemoval(null)}
      >
        {removalFailed ? (
          <p role="alert" className="m-0 text-body-sm text-bad">
            <Trans>
              Some threads could not be deleted. Only the person who started a thread or a project
              owner deletes it.
            </Trans>
          </p>
        ) : null}
      </SmallModal>
      {draft && draftAt ? (
        <>
          {draft.target.kind === "point" ? (
            <span
              data-testid="pin-draft"
              aria-hidden
              className="absolute size-7 -translate-y-full rounded-full rounded-bl-none bg-accent-fill opacity-70"
              style={{ left: draftAt.x, top: draftAt.y }}
            />
          ) : null}
          <TargetComposer
            key={`${draft.target.kind}:${draft.at.x},${draft.at.y}`}
            target={draft.target}
            at={draftAt}
            offReason={startHome === null ? noPlaceReason : undefined}
            failed={create.isError || answer.isError}
            busy={create.isPending || answer.isPending}
            onSend={send}
            onCancel={() => setDraft(null)}
            onPinInstead={
              draft.clicked === undefined
                ? undefined
                : () => {
                    const at = draft.clicked ?? draft.at;
                    setDraft({ target: { kind: "point", at }, at });
                  }
            }
          />
        </>
      ) : null}
    </div>
  );
}
