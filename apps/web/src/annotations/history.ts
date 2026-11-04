import type { AnnotationDocument } from "./document.ts";

export type EntryId = number;

export interface HistoryEntry {
  readonly id: EntryId;
  readonly label: string;
  readonly before: AnnotationDocument;
  readonly after: AnnotationDocument;
}

export interface History {
  readonly entries: readonly HistoryEntry[];
  readonly cursor: number;
  readonly nextId: EntryId;
}

export type Transient = {
  readonly draft: number;
  readonly prompts: number;
};

export type UndoTarget = "draft" | "prompt" | "edit" | "none";

export type Applied = {
  readonly history: History;
  readonly document: AnnotationDocument;
  readonly label: string;
};

export const historyLimit = 200;

export function createHistory(): History {
  return { entries: [], cursor: 0, nextId: 1 };
}

export function canUndo(history: History): boolean {
  return history.cursor > 0;
}

export function canRedo(history: History): boolean {
  return history.cursor < history.entries.length;
}

export function undoTarget(history: History, transient: Transient): UndoTarget {
  if (transient.draft > 0) return "draft";
  if (transient.prompts > 0) return "prompt";
  return canUndo(history) ? "edit" : "none";
}

export function record(
  history: History,
  before: AnnotationDocument,
  after: AnnotationDocument,
  label: string,
): { history: History; id: EntryId | null } {
  if (before === after) return { history, id: null };
  const id = history.nextId;
  const entries = [...history.entries.slice(0, history.cursor), { id, label, before, after }];
  const kept = entries.slice(Math.max(0, entries.length - historyLimit));
  return { history: { entries: kept, cursor: kept.length, nextId: id + 1 }, id };
}

export function undo(history: History): Applied | null {
  const entry = history.entries[history.cursor - 1];
  if (entry === undefined) return null;
  return {
    history: { ...history, cursor: history.cursor - 1 },
    document: entry.before,
    label: entry.label,
  };
}

export function redo(history: History): Applied | null {
  const entry = history.entries[history.cursor];
  if (entry === undefined) return null;
  return {
    history: { ...history, cursor: history.cursor + 1 },
    document: entry.after,
    label: entry.label,
  };
}

export function fold(
  history: History,
  id: EntryId,
  change: (doc: AnnotationDocument) => AnnotationDocument,
): { history: History; document: AnnotationDocument | null } {
  const index = history.entries.findIndex((entry) => entry.id === id);
  if (index < 0) return { history, document: null };
  const entries = history.entries.map((entry, position) => {
    if (position < index) return entry;
    if (position === index) return { ...entry, after: change(entry.after) };
    return { ...entry, before: change(entry.before), after: change(entry.after) };
  });
  const head = entries[history.cursor - 1];
  const live = index < history.cursor && head !== undefined ? head.after : null;
  return { history: { ...history, entries }, document: live };
}
