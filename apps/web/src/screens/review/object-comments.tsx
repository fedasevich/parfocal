import {
  getListSlideThreadsQueryKey,
  getListThreadCommentsQueryKey,
  getListThreadsQueryKey,
  type SlideThread,
  type ThreadComment,
  useCreateThread,
  useListThreadComments,
  useReplyToThread,
} from "@parfocal/api-client";
import {
  CommentComposer,
  type CommentMessage,
  CommentThread,
  MentionPicker,
} from "@parfocal/ui/components/comment-thread";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { commentDraftId, useKeptDraft } from "../../session/kept-drafts.ts";
import { usePeople } from "../people.ts";
import { pinTitle } from "./comment-pin.ts";
import {
  fromMentionTokens,
  mentionOptions,
  mentionQuery,
  toMentionTokens,
  withMention,
} from "./mention-picking.ts";
import { useMentionable } from "./use-mentionable.ts";

const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatStamp = (at: string) => stamp.format(new Date(at)).replace(",", "");

export function useThreadMessages(thread: SlideThread | undefined, meId: string | undefined) {
  const person = usePeople();
  const comments = useListThreadComments(thread?.id ?? "", {
    query: { enabled: thread !== undefined },
  }).data?.data;
  const toMessage = (comment: ThreadComment): CommentMessage => ({
    id: comment.id,
    author: person(comment.author_id) ?? { name: "Someone", initials: "?", color: "#64748b" },
    you: comment.author_id === meId,
    researcher: comment.author_is_researcher,
    at: formatStamp(comment.created_at),
    text: fromMentionTokens(comment.text, (userId) => person(userId)?.name),
    replyTo: comment.reply_to,
  });
  return thread ? (comments ?? []).map(toMessage) : [];
}

type ThreadBodyProps = {
  taskId: string;
  slideId: string;
  object: string;
  thread: SlideThread | undefined;
  meId: string | undefined;
  blind: boolean;
  blindReviewers: string[];
  initialDraft?: string;
  offReason?: string | undefined;
  onSent?: (text: string) => void;
};

export function ObjectThread({
  taskId,
  slideId,
  object,
  thread,
  meId,
  blind,
  blindReviewers,
  initialDraft = "",
  offReason,
  onSent,
}: ThreadBodyProps) {
  const loaded = useThreadMessages(thread, meId);
  const members = useMentionable();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useKeptDraft(
    meId,
    commentDraftId(thread?.id, object, window.location.pathname),
    initialDraft,
  );
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const messages = loaded;
  const query = mentionQuery(draft);
  const options = mentionOptions(draft, members, meId, blind ? blindReviewers : []);
  const pickable = options.filter((option) => !option.disabledReason);
  const pick = (id: string) => {
    const name = members.find((member) => member.id === id)?.name;
    if (name) setDraft(withMention(draft, name));
  };
  const posted = (text: string) => {
    void queryClient.invalidateQueries({ queryKey: getListSlideThreadsQueryKey(slideId) });
    void queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey(taskId, slideId) });
    if (thread) {
      void queryClient.invalidateQueries({ queryKey: getListThreadCommentsQueryKey(thread.id) });
    }
    setDraft("");
    setReplyTo(null);
    onSent?.(text);
  };
  const create = useCreateThread({ mutation: { onSuccess: (_, sent) => posted(sent.data.body) } });
  const reply = useReplyToThread({ mutation: { onSuccess: (_, sent) => posted(sent.data.body) } });
  const pending = create.isPending || reply.isPending;
  const failed = create.isError || reply.isError;
  const send = () => {
    const text = draft.trim();
    if (!text || meId === undefined || pending) return;
    const body = toMentionTokens(text, members);
    if (thread) {
      reply.mutate({ taskId, slideId, threadId: thread.id, data: { body } });
      return;
    }
    create.mutate({
      taskId,
      slideId,
      data: {
        title: pinTitle(text),
        body,
        anchor: { kind: "object", object_id: object, geometry: null, offset: null },
      },
    });
  };
  const replyingTo = replyTo ? messages.find((message) => message.id === replyTo) : undefined;
  return (
    <div className="grid gap-4">
      {messages.length ? (
        <CommentThread messages={messages} onReply={setReplyTo} />
      ) : (
        <p className="m-0 text-body-sm text-fg-dim">
          No comments on {object} yet. Write the first one below.
        </p>
      )}
      <CommentComposer
        value={draft}
        onValueChange={setDraft}
        onSend={send}
        label={`Comment on ${object}`}
        hint={
          blind
            ? "Blind review. Other reviewers see it after they submit."
            : "Everyone on the task sees it."
        }
        offReason={offReason}
        replyingTo={replyingTo?.author.name}
        onCancelReply={() => setReplyTo(null)}
        onPickerKey={(key) => {
          if (key === "Escape") {
            setDraft(`${draft} `);
            return;
          }
          if (key === "ArrowDown" || key === "ArrowUp") {
            const step = key === "ArrowDown" ? 1 : pickable.length - 1;
            setActive((active + step) % Math.max(1, pickable.length));
            return;
          }
          const chosen = pickable[Math.min(active, pickable.length - 1)];
          if (chosen) pick(chosen.id);
        }}
        picker={
          query === undefined ? undefined : (
            <MentionPicker
              options={options}
              activeId={pickable[Math.min(active, pickable.length - 1)]?.id}
              query={query}
              onPick={pick}
            />
          )
        }
      />
      {failed ? (
        <p role="alert" className="m-0 text-body-sm text-bad">
          The comment did not save. Try again.
        </p>
      ) : null}
    </div>
  );
}

type ObjectCommentsProps = Omit<ThreadBodyProps, "thread"> & {
  threads: SlideThread[];
  decisionNotes?: ReactNode;
};

export function ObjectComments({
  object,
  threads,
  decisionNotes = null,
  ...props
}: ObjectCommentsProps) {
  const thread = threads.find((item) => item.anchor === object);
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-fg-dim">Comments on this object</span>
        <ObjectIdTag size="lg">{object}</ObjectIdTag>
      </div>
      {decisionNotes ? (
        <section aria-label={`Decision notes on ${object}`} className="grid gap-2">
          <h3 className="m-0 text-label font-semibold uppercase tracking-wide text-fg-dim">
            Decision notes
          </h3>
          {decisionNotes}
        </section>
      ) : null}
      <ObjectThread key={object} object={object} thread={thread} {...props} />
    </div>
  );
}
