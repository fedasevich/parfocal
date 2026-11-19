import { type Thread, useListThreads, useListThreadsOnSlide } from "@parfocal/api-client";
import {
  CommentsTab,
  type CommentThreadCard,
  type DecisionNoteCard,
} from "@parfocal/ui/components/comments-tab";
import { threadScope } from "../annotations/thread-home.ts";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { countWord, reasonText } from "../screens/review/decision-style.ts";
import { formatStamp } from "../screens/review/object-comments.tsx";
import { useReviewSession } from "../screens/review/review-data.ts";
import { anchorKind, anchorLabel } from "../screens/review/threads-tab.tsx";

type StageCommentsProps = {
  projectId: string | undefined;
  taskId: string | undefined;
  taskName: string | undefined;
  slideId: string;
  slideLabel: string;
  notes?: DecisionNoteCard[];
  onGoTo: (thread: Thread) => void;
  onOpen: (thread: Thread) => void;
  onSelectNote?: (object: string) => void;
  onNewComment: () => void;
};

export function useDecisionNoteCards(taskId: string, slideId: string): DecisionNoteCard[] {
  const session = useReviewSession(taskId, slideId);
  const person = usePeople();
  return session.objects.flatMap((item) => {
    const decision = session.decisions.get(item.object);
    if (decision === undefined || (!decision.note && decision.reasons.length === 0)) return [];
    const text = [
      decision.reasons.map((code) => reasonText[code] ?? code).join(", "),
      decision.note ?? "",
    ]
      .filter(Boolean)
      .join(" \u00b7 ");
    return [
      {
        id: item.object,
        anchor: item.object,
        decision: countWord[decision.value],
        author: person(session.meId),
        text,
      },
    ];
  });
}

export function ReviewStageComments(props: StageCommentsProps & { reviewTaskId: string }) {
  const notes = useDecisionNoteCards(props.reviewTaskId, props.slideId);
  return <StageComments {...props} notes={notes} />;
}

export function StageComments({
  projectId,
  taskId,
  taskName,
  slideId,
  slideLabel,
  notes,
  onGoTo,
  onOpen,
  onSelectNote,
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
      notes={notes}
      onSelectNote={onSelectNote}
      onNewComment={onNewComment}
      onSelect={(id) => {
        const thread = threads.find((item) => item.id === id);
        if (thread) onOpen(thread);
      }}
      onGoTo={(id) => {
        const thread = threads.find((item) => item.id === id);
        if (thread) onGoTo(thread);
      }}
    />
  );
}
