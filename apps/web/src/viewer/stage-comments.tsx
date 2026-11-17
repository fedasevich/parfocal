import { type Thread, useListThreads, useListThreadsOnSlide } from "@parfocal/api-client";
import { CommentsTab, type CommentThreadCard } from "@parfocal/ui/components/comments-tab";
import { threadScope } from "../annotations/thread-home.ts";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { formatStamp } from "../screens/review/object-comments.tsx";
import { anchorKind, anchorLabel } from "../screens/review/threads-tab.tsx";

type StageCommentsProps = {
  projectId: string | undefined;
  taskId: string | undefined;
  taskName: string | undefined;
  slideId: string;
  slideLabel: string;
  onGoTo: (thread: Thread) => void;
  onNewComment: () => void;
};

export function StageComments({
  projectId,
  taskId,
  taskName,
  slideId,
  slideLabel,
  onGoTo,
  onNewComment,
}: StageCommentsProps) {
  const person = usePeople();
  const onTask = useListThreads(taskId ?? "", slideId, undefined, {
    query: { enabled: taskId !== undefined },
  });
  const onSlide = useListThreadsOnSlide(projectId ?? "", slideId, undefined, {
    query: { enabled: projectId !== undefined },
  });
  const threads: Thread[] = [
    ...(taskId === undefined ? [] : (okData(onTask.data) ?? [])),
    ...(projectId === undefined ? [] : (okData(onSlide.data) ?? [])),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const cards: CommentThreadCard[] = threads.map((thread) => ({
    id: thread.id,
    anchor: anchorLabel(thread),
    kind: anchorKind(thread),
    scope: threadScope(thread, taskName),
    title: thread.title,
    author: person(thread.created_by),
    messages: thread.message_count,
    at: formatStamp(thread.last_message_at),
    resolved: thread.resolved_at !== null,
  }));
  return (
    <CommentsTab
      data-testid="stage-comments"
      slideLabel={slideLabel}
      threads={cards}
      onNewComment={onNewComment}
      onGoTo={(id) => {
        const thread = threads.find((item) => item.id === id);
        if (thread) onGoTo(thread);
      }}
    />
  );
}
