import { type Thread, useListThreads } from "@parfocal/api-client";
import { CommentsTab, type CommentThreadCard } from "@parfocal/ui/components/comments-tab";
import type { ThreadFilter } from "@parfocal/ui/lib/comment-threads";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { formatStamp } from "./object-comments.tsx";

export const anchorLabel = (thread: Thread) =>
  thread.anchor.object_id ?? (thread.anchor.kind === "point" ? "Pin" : "Shape");

export const anchorKind = (thread: Thread) => {
  const { kind, object_id: object } = thread.anchor;
  if (kind === "roi") return "Your ROI";
  if (kind === "point") return "Pin";
  if (kind === "shape") return "Shape";
  return object?.includes("·") ? "Cell" : "Tumor region";
};

export const useSlideThreads = (taskId: string, slideId: string) =>
  okData(useListThreads(taskId, slideId, undefined, { query: { enabled: slideId !== "" } }).data) ??
  [];

export const openThreadCount = (threads: Thread[]) =>
  threads.filter((thread) => thread.resolved_at === null).length;

type ThreadsTabProps = {
  taskId: string;
  slideId: string;
  slideLabel: string;
  selected?: string | undefined;
  hidden?: boolean;
  onOpen: (anchor: string) => void;
  onGoTo: (anchor: string) => void;
  onNewComment?: (() => void) | undefined;
};

export function ThreadsTab({
  taskId,
  slideId,
  slideLabel,
  selected,
  hidden = false,
  onOpen,
  onGoTo,
  onNewComment,
}: ThreadsTabProps) {
  const threads = useSlideThreads(taskId, slideId);
  const person = usePeople();
  const shown = hidden ? [] : threads;
  const selectedThread = shown.find((thread) => thread.anchor.object_id === selected);
  const filter: ThreadFilter =
    selectedThread && selectedThread.resolved_at !== null ? "resolved" : "open";
  const cards: CommentThreadCard[] = shown.map((thread) => ({
    id: thread.id,
    anchor: anchorLabel(thread),
    kind: anchorKind(thread),
    title: thread.title,
    author: person(thread.created_by),
    messages: thread.message_count,
    at: formatStamp(thread.last_message_at),
    resolved: thread.resolved_at !== null,
  }));
  const anchorOf = (id: string) => shown.find((thread) => thread.id === id)?.anchor.object_id;
  return (
    <CommentsTab
      slideLabel={slideLabel}
      threads={cards}
      selectedId={selectedThread?.id}
      key={filter}
      defaultFilter={filter}
      onSelect={(id) => {
        const anchor = anchorOf(id);
        if (anchor) onOpen(anchor);
      }}
      onGoTo={(id) => {
        const anchor = anchorOf(id);
        if (anchor) onGoTo(anchor);
      }}
      {...(onNewComment ? { onNewComment } : {})}
    />
  );
}
