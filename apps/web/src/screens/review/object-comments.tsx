import {
  type SlideThread,
  type ThreadComment,
  useListTenantMembers,
  useListThreadComments,
} from "@parfocal/api-client";
import {
  CommentComposer,
  type CommentMessage,
  CommentThread,
  type MentionOption,
  MentionPicker,
} from "@parfocal/ui/components/comment-thread";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { useState } from "react";
import { commentDraftId, useKeptDraft } from "../../session/kept-drafts.ts";
import { toPersonInfo, usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";

const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatStamp = (at: string) => stamp.format(new Date(at)).replace(",", "");

const mentionQuery = (text: string) => text.match(/(^|\s)@([^\s@]{0,24})$/)?.[2];

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

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
    text: comment.text,
    replyTo: comment.reply_to,
  });
  return thread ? (comments ?? []).map(toMessage) : [];
}

type ThreadBodyProps = {
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
  const members = okData(useListTenantMembers().data) ?? [];
  const person = usePeople();
  const [sent, setSent] = useState<CommentMessage[]>([]);
  const [draft, setDraft] = useKeptDraft(
    meId,
    commentDraftId(thread?.id, object, window.location.pathname),
    initialDraft,
  );
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const messages = [...loaded, ...sent];
  const query = mentionQuery(draft);
  const options: MentionOption[] =
    query === undefined
      ? []
      : members
          .filter((member) => member.user_id !== meId)
          .filter((member) =>
            fold(member.display_name)
              .split(" ")
              .some((word) => word.startsWith(fold(query))),
          )
          .map((member) => ({
            id: member.user_id,
            person: toPersonInfo(member),
            sub: member.title ?? "",
            ...(blind && blindReviewers.includes(member.user_id)
              ? { disabledReason: "Reviews this task blind" }
              : {}),
          }));
  const pickable = options.filter((option) => !option.disabledReason);
  const pick = (id: string) => {
    const name = members.find((member) => member.user_id === id)?.display_name;
    if (name) setDraft(draft.replace(/@([^\s@]{0,24})$/, `@${name} `));
  };
  const send = () => {
    const text = draft.trim();
    if (!text || meId === undefined) return;
    const me = person(meId);
    setSent([
      ...sent,
      {
        id: `local-${sent.length}`,
        author: me ?? { name: "You", initials: "?", color: "#2563eb" },
        you: true,
        at: "just now",
        text,
        replyTo,
      },
    ]);
    setDraft("");
    setReplyTo(null);
    onSent?.(text);
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
    </div>
  );
}

type ObjectCommentsProps = Omit<ThreadBodyProps, "thread"> & { threads: SlideThread[] };

export function ObjectComments({ object, threads, ...props }: ObjectCommentsProps) {
  const thread = threads.find((item) => item.anchor === object);
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-fg-dim">Comments on this object</span>
        <ObjectIdTag size="lg">{object}</ObjectIdTag>
      </div>
      <ObjectThread key={object} object={object} thread={thread} {...props} />
    </div>
  );
}
