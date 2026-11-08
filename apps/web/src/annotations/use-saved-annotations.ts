import { type AnnotationDraft, getSharedLayer, listAnnotations } from "@parfocal/api-client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { adoptTheirs } from "./conflicts.ts";
import { deleteMarker, dropMarker } from "./count-markers.ts";
import { type AnnotationDocument, addShape, createDocument } from "./document.ts";
import {
  canRedo,
  canUndo,
  createHistory,
  type EntryId,
  fold,
  type History,
  record,
  redo,
  undo,
} from "./history.ts";
import { intoGroup } from "./layers.ts";
import type { Point } from "./polygon-draft.ts";
import {
  type Choice,
  type Conflict,
  createSaveQueue,
  type QueuePhase,
  type Remote,
} from "./save-queue.ts";
import { annotationTransport, sharedLayerTransport } from "./save-transport.ts";
import { draftOf, type SavedRecord, sameBody, shapeOf } from "./saved-shapes.ts";
import type { GroupId, Shape, ShapeId } from "./shapes.ts";

export type SaveState = QueuePhase;

export type SaveConflict = Conflict<AnnotationDraft>;

export type SavedAnnotations = {
  readonly document: AnnotationDocument;
  readonly setDocument: (next: AnnotationDocument) => void;
  readonly savePolygon: (points: Float32Array, classKey?: string | null) => void;
  readonly saveMarker: (point: Point, classKey: string | null) => void;
  readonly removeMarker: (id: ShapeId) => void;
  readonly commit: (before: AnnotationDocument, after: AnnotationDocument, label: string) => void;
  readonly apply: (next: AnnotationDocument, label: string) => void;
  readonly latest: () => AnnotationDocument;
  readonly undo: () => string | null;
  readonly redo: () => string | null;
  readonly fold: (id: EntryId, change: (doc: AnnotationDocument) => AnnotationDocument) => void;
  readonly target: GroupId | null;
  readonly setTarget: (id: GroupId | null) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly loaded: boolean;
  readonly saveState: SaveState;
  readonly unsaved: number;
  readonly conflicts: readonly SaveConflict[];
  readonly resolveConflict: (conflict: SaveConflict, choice: Choice) => void;
};

type LoadedRecord = SavedRecord & { readonly id: string; readonly version: number };

async function savedRecords(
  slideId: string,
  sharedTaskId: string | null,
): Promise<readonly LoadedRecord[] | null> {
  if (sharedTaskId === null) {
    const saved = await listAnnotations(slideId);
    return saved.status === 200 ? saved.data : null;
  }
  const layer = await getSharedLayer(sharedTaskId, slideId);
  if (layer.status !== 200) return null;
  return layer.data.objects.filter((item) => item.deleted_at === null && item.source === null);
}

export function useSavedAnnotations(
  slideId: string,
  enabled: boolean,
  sharedTaskId: string | null = null,
): SavedAnnotations {
  const [document, setDocumentState] = useState(createDocument);
  const [loaded, setLoaded] = useState(false);
  const [target, setTargetState] = useState<GroupId | null>(null);
  const targetRef = useRef<GroupId | null>(null);
  const setTarget = useCallback((id: GroupId | null) => {
    targetRef.current = id;
    setTargetState(id);
  }, []);
  const [history, setHistoryState] = useState(createHistory);
  const current = useRef(document);
  const log = useRef(history);
  const remotes = useRef(new Map<ShapeId, Remote>());
  const queue = useMemo(
    () =>
      createSaveQueue(
        sharedTaskId === null
          ? annotationTransport(slideId)
          : sharedLayerTransport(sharedTaskId, slideId),
      ),
    [slideId, sharedTaskId],
  );
  const status = useSyncExternalStore(queue.subscribe, queue.status);
  const conflicts = useSyncExternalStore(queue.subscribe, queue.conflicts);
  const hasUnsaved = status.waiting > 0;

  useEffect(() => {
    const resume = () => queue.flushNow();
    window.addEventListener("online", resume);
    return () => {
      window.removeEventListener("online", resume);
      queue.flushNow();
    };
  }, [queue]);

  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  const setDocument = useCallback((next: AnnotationDocument) => {
    current.current = next;
    setDocumentState(next);
  }, []);

  const setHistory = useCallback((next: History) => {
    log.current = next;
    setHistoryState(next);
  }, []);

  const createFor = useCallback(
    (shape: Shape) => {
      const body = draftOf(shape);
      if (body === null) return;
      const remote: Remote = { id: null, version: 1 };
      remotes.current.set(shape.id, remote);
      queue.enqueueCreate(remote, body);
    },
    [queue],
  );

  const deleteFor = useCallback(
    (id: ShapeId) => {
      const remote = remotes.current.get(id);
      remotes.current.delete(id);
      if (remote !== undefined) queue.enqueueRemove(remote);
    },
    [queue],
  );

  const updateFor = useCallback(
    (shape: Shape) => {
      const remote = remotes.current.get(shape.id);
      const body = draftOf(shape);
      if (remote !== undefined && body !== null) queue.enqueueUpdate(remote, body);
    },
    [queue],
  );

  const sync = useCallback(
    (previous: AnnotationDocument, next: AnnotationDocument) => {
      for (const id of previous.shapes.keys()) {
        if (!next.shapes.has(id)) deleteFor(id);
      }
      for (const [id, shape] of next.shapes) {
        const before = previous.shapes.get(id);
        if (before === undefined) createFor(shape);
        else if (before !== shape && !sameBody(before, shape)) updateFor(shape);
      }
    },
    [createFor, deleteFor, updateFor],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    remotes.current.clear();
    setDocument(createDocument());
    setHistory(createHistory());
    setLoaded(false);
    void savedRecords(slideId, sharedTaskId).then(
      (records) => {
        if (cancelled || records === null) return;
        let next = createDocument();
        for (const annotation of records) {
          const input = shapeOf(annotation);
          if (input === null) continue;
          const added = addShape(next, input);
          next = added.document;
          remotes.current.set(added.shape.id, { id: annotation.id, version: annotation.version });
        }
        setDocument(next);
        setLoaded(true);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [slideId, sharedTaskId, enabled, setDocument, setHistory]);

  const recordEdit = useCallback(
    (before: AnnotationDocument, after: AnnotationDocument, label: string) => {
      setHistory(record(log.current, before, after, label).history);
    },
    [setHistory],
  );

  const commit = useCallback(
    (before: AnnotationDocument, after: AnnotationDocument, label: string) => {
      recordEdit(before, after, label);
      sync(before, after);
    },
    [recordEdit, sync],
  );

  const savePolygon = useCallback(
    (points: Float32Array, classKey: string | null = null) => {
      const before = current.current;
      const added = addShape(before, { kind: "polygon", points, classKey });
      const placed = intoGroup(before, added.document, targetRef.current);
      setDocument(placed);
      recordEdit(before, placed, "Add outline");
      createFor(added.shape);
    },
    [setDocument, recordEdit, createFor],
  );

  const saveMarker = useCallback(
    (point: Point, classKey: string | null) => {
      const before = current.current;
      const added = dropMarker(before, point, classKey);
      const placed = intoGroup(before, added.document, targetRef.current);
      setDocument(placed);
      recordEdit(before, placed, "Add marker");
      createFor(added.shape);
    },
    [setDocument, recordEdit, createFor],
  );

  const removeMarker = useCallback(
    (id: ShapeId) => {
      const before = current.current;
      const next = deleteMarker(before, id);
      if (next === before) return;
      setDocument(next);
      recordEdit(before, next, "Remove marker");
      deleteFor(id);
    },
    [setDocument, recordEdit, deleteFor],
  );

  const apply = useCallback(
    (next: AnnotationDocument, label: string) => {
      const before = current.current;
      if (next === before) return;
      const placed = intoGroup(before, next, targetRef.current);
      setDocument(placed);
      commit(before, placed, label);
    },
    [setDocument, commit],
  );

  const travel = useCallback(
    (step: typeof undo | typeof redo): string | null => {
      const applied = step(log.current);
      if (applied === null) return null;
      const previous = current.current;
      setHistory(applied.history);
      setDocument(applied.document);
      sync(previous, applied.document);
      return applied.label;
    },
    [setHistory, setDocument, sync],
  );

  const undoLast = useCallback(() => travel(undo), [travel]);
  const redoLast = useCallback(() => travel(redo), [travel]);

  const foldInto = useCallback(
    (id: EntryId, change: (doc: AnnotationDocument) => AnnotationDocument) => {
      const folded = fold(log.current, id, change);
      setHistory(folded.history);
      if (folded.document === null) return;
      const previous = current.current;
      setDocument(folded.document);
      sync(previous, folded.document);
    },
    [setHistory, setDocument, sync],
  );

  const resolveConflict = useCallback(
    (conflict: SaveConflict, choice: Choice) => {
      if (choice === "theirs") {
        const held = [...remotes.current].find(([, remote]) => remote === conflict.remote);
        const shapeId = held === undefined ? null : held[0];
        const adopted = adoptTheirs(current.current, shapeId, conflict.theirs);
        if (shapeId !== null) remotes.current.delete(shapeId);
        if (adopted.shapeId !== null) remotes.current.set(adopted.shapeId, conflict.remote);
        setDocument(adopted.document);
      }
      queue.resolve(conflict, choice);
    },
    [queue, setDocument],
  );

  const latest = useCallback(() => current.current, []);

  return {
    document,
    setDocument,
    latest,
    savePolygon,
    saveMarker,
    removeMarker,
    commit,
    apply,
    undo: undoLast,
    redo: redoLast,
    fold: foldInto,
    target,
    setTarget,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    loaded,
    saveState: status.phase,
    unsaved: status.waiting,
    conflicts,
    resolveConflict,
  };
}
