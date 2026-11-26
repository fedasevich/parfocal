import { Trans } from "@lingui/react/macro";
import {
  type Thread,
  useGetReviewTask,
  useListSlideResultSets,
  useListThreads,
  useListThreadsOnSlide,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { CommentsTab, type CommentThreadCard } from "@parfocal/ui/components/comments-tab";
import type { ThreadFilter } from "@parfocal/ui/lib/comment-threads";
import { useEffect, useState } from "react";
import { anchorWords } from "../../annotations/anchor-words.ts";
import { reachMention } from "../../annotations/comment-bus.ts";
import { publishReferences } from "../../annotations/comment-references.ts";
import { createDocument } from "../../annotations/document.ts";
import { anchorReferences } from "../../annotations/pin-references.ts";
import { PinThread } from "../../annotations/pin-thread.tsx";
import { threadScope } from "../../annotations/thread-home.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { formatStamp } from "./object-comments.tsx";

const noDocument = createDocument();

type LayerNameOf = (key: string) => string | undefined;

const noLayerName: LayerNameOf = () => undefined;

export const anchorLabel = (thread: Thread, layerName: LayerNameOf = noLayerName) =>
  anchorWords(thread.anchor, layerName).label;

export const anchorKind = (thread: Thread, layerName: LayerNameOf = noLayerName) =>
  anchorWords(thread.anchor, layerName).kind;

export const useSlideThreads = (taskId: string, slideId: string) =>
  okData(useListThreads(taskId, slideId, undefined, { query: { enabled: slideId !== "" } }).data) ??
  [];

const useTaskAndSlideThreads = (taskId: string, slideId: string) => {
  const task = okData(useGetReviewTask(taskId).data);
  const projectId = task?.project_id ?? "";
  const onTask = useSlideThreads(taskId, slideId);
  const onSlide =
    okData(
      useListThreadsOnSlide(projectId, slideId, undefined, {
        query: { enabled: projectId !== "" && slideId !== "" },
      }).data,
    ) ?? [];
  const sets =
    okData(useListSlideResultSets(slideId, { query: { enabled: slideId !== "" } }).data) ?? [];
  const threads = [...onTask, ...onSlide].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const setName = (id: string) => sets.find((set) => set.id === id)?.name;
  return { threads, taskName: task?.name, setName };
};

export const openThreadCount = (threads: Thread[]) =>
  threads.filter((thread) => thread.resolved_at === null).length;

export const openThreadsWarning = (count: number, where: string) =>
  count === 0
    ? undefined
    : `${count} open thread${count === 1 ? "" : "s"} on ${where}. You can still submit.`;

export const useOpenThreadsWarning = (taskId: string, slideId: string) =>
  openThreadsWarning(openThreadCount(useSlideThreads(taskId, slideId)), "this slide");

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
  const { threads, taskName, setName } = useTaskAndSlideThreads(taskId, slideId);
  const person = usePeople();
  const [reading, setReading] = useState<string | null>(null);
  const shown = hidden ? [] : threads;
  const read = shown.find((thread) => thread.id === reading);
  const source = `tab:${slideId}`;
  useEffect(() => publishReferences(source, anchorReferences(shown)));
  useEffect(() => () => publishReferences(source, []), [source]);
  const selectedThread = shown.find((thread) => thread.anchor.object_id === selected);
  const filter: ThreadFilter =
    selectedThread && selectedThread.resolved_at !== null ? "resolved" : "open";
  const cards: CommentThreadCard[] = shown.map((thread) => ({
    id: thread.id,
    anchor: anchorLabel(thread),
    kind: anchorKind(thread),
    scope: threadScope(thread, taskName, setName),
    title: thread.title,
    author: person(thread.created_by),
    messages: thread.message_count,
    at: formatStamp(thread.last_message_at),
    resolved: thread.resolved_at !== null,
  }));
  const anchorOf = (id: string) => shown.find((thread) => thread.id === id)?.anchor.object_id;
  const reachOther = (id: string) => {
    const thread = shown.find((item) => item.id === id);
    if (thread) reachMention({ kind: "anchor", anchor: thread.anchor }, slideId);
  };
  if (read) {
    return (
      <div data-testid="thread-reader" data-thread={read.id} className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body text-fg-dim">
            {anchorLabel(read)} · {anchorKind(read)}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setReading(null)}>
            <Trans>All comments</Trans>
          </Button>
        </div>
        <PinThread
          thread={read}
          document={noDocument}
          micronsPerPixel={null}
          spot={null}
          onClose={() => setReading(null)}
        />
      </div>
    );
  }
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
        else {
          reachOther(id);
          setReading(id);
        }
      }}
      onGoTo={(id) => {
        const anchor = anchorOf(id);
        if (anchor) onGoTo(anchor);
        else reachOther(id);
      }}
      {...(onNewComment ? { onNewComment } : {})}
    />
  );
}
