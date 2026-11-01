import { Button } from "@parfocal/ui/components/button";
import { Keycap } from "@parfocal/ui/components/keycap";
import { PersonAvatar, type PersonInfo } from "@parfocal/ui/components/person";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

const mentionPattern = /(@\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+)/u;

function MentionText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(mentionPattern);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <b key={`${index}-${part}`} className="font-semibold text-accent">
            {part}
          </b>
        ) : (
          part
        ),
      )}
    </span>
  );
}

type CommentMessage = {
  id: string;
  author: PersonInfo;
  you?: boolean;
  researcher?: boolean;
  at: string;
  text: string;
  replyTo?: string | null;
};

type CommentItemProps = React.ComponentProps<"div"> & {
  message: CommentMessage;
  reply?: boolean;
  onReply?: (() => void) | undefined;
};

function CommentItem({ message, reply = false, onReply, className, ...props }: CommentItemProps) {
  return (
    <div
      data-slot="comment"
      data-reply={reply || undefined}
      className={cn("grid grid-cols-[24px_minmax(0,1fr)] gap-2.5", reply && "pl-8.5", className)}
      {...props}
    >
      <PersonAvatar person={message.author} size={22} className="mt-0.5" />
      <div className="grid gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-body-sm">
          <b className="font-semibold text-fg">
            {message.author.name}
            {message.you ? " (you)" : ""}
          </b>
          {message.researcher ? <span className="text-caption text-fg-dim">Researcher</span> : null}
          <span className="text-caption text-fg-dim">{message.at}</span>
        </div>
        <p className="m-0 text-body-sm leading-[1.45] text-fg">
          <MentionText text={message.text} />
        </p>
        {!reply && onReply ? (
          <button
            type="button"
            onClick={onReply}
            className="w-fit cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Reply
          </button>
        ) : null}
      </div>
    </div>
  );
}

type CommentThreadProps = React.ComponentProps<"div"> & {
  messages: CommentMessage[];
  onReply?: ((messageId: string) => void) | undefined;
};

function CommentThread({ messages, onReply, className, ...props }: CommentThreadProps) {
  const ids = new Set(messages.map((message) => message.id));
  const roots = messages.filter((message) => !message.replyTo || !ids.has(message.replyTo));
  return (
    <div data-slot="comment-thread" className={cn("grid gap-3.5", className)} {...props}>
      {roots.map((root) => (
        <div key={root.id} className="grid gap-3.5">
          <CommentItem message={root} onReply={onReply ? () => onReply(root.id) : undefined} />
          {messages
            .filter((message) => message.replyTo === root.id)
            .map((message) => (
              <CommentItem key={message.id} message={message} reply />
            ))}
        </div>
      ))}
    </div>
  );
}

type MentionOption = { id: string; person: PersonInfo; sub: string; disabledReason?: string };

type MentionPickerProps = React.ComponentProps<"div"> & {
  options: MentionOption[];
  activeId?: string | undefined;
  query: string;
  onPick?: ((id: string) => void) | undefined;
};

function MentionPicker({
  options,
  activeId,
  query,
  onPick,
  className,
  ...props
}: MentionPickerProps) {
  return (
    <div
      data-slot="mention-picker"
      role="listbox"
      aria-label="Mention someone"
      className={cn(
        "grid gap-0.5 rounded-zone border border-line-strong bg-chrome p-1 shadow-pop",
        className,
      )}
      {...props}
    >
      {options.length === 0 ? (
        <div className="px-3 py-2 text-body-sm text-fg-dim">
          Nobody called "{query}" in this project.
        </div>
      ) : (
        options.map((option) => {
          const active = option.id === activeId && !option.disabledReason;
          return (
            <div
              key={option.id}
              role="option"
              tabIndex={-1}
              aria-selected={active}
              aria-disabled={option.disabledReason ? true : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                if (!option.disabledReason) onPick?.(option.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !option.disabledReason) onPick?.(option.id);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2",
                active && "bg-chrome-2",
                option.disabledReason && "cursor-default opacity-50",
              )}
            >
              <PersonAvatar person={option.person} size={24} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <b className="text-body-sm font-medium text-fg">{option.person.name}</b>
                <small className="text-caption text-fg-dim">{option.sub}</small>
              </span>
              {option.disabledReason ? (
                <span className="text-caption text-fg-dim">{option.disabledReason}</span>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

type CommentComposerProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  onSend?: (() => void) | undefined;
  label: string;
  placeholder?: string;
  hint?: React.ReactNode;
  sendLabel?: string;
  offReason?: string | undefined;
  replyingTo?: string | undefined;
  onCancelReply?: (() => void) | undefined;
  picker?: React.ReactNode;
};

function CommentComposer({
  value,
  onValueChange,
  onSend,
  label,
  placeholder = "Write a comment. Type @ to mention someone",
  hint,
  sendLabel = "Send",
  offReason,
  replyingTo,
  onCancelReply,
  picker,
  className,
  ...props
}: CommentComposerProps) {
  const empty = value.trim() === "";
  return (
    <div data-slot="comment-composer" className={cn("grid gap-2", className)} {...props}>
      {replyingTo ? (
        <div className="flex items-center justify-between text-caption text-fg-dim">
          <span>Replying to {replyingTo}</span>
          <button
            type="button"
            onClick={onCancelReply}
            className="cursor-pointer border-0 bg-transparent p-0 text-caption font-medium text-accent"
          >
            Cancel
          </button>
        </div>
      ) : null}
      <div className="relative grid gap-1">
        <textarea
          aria-label={label}
          rows={2}
          value={value}
          placeholder={replyingTo ? "Write a reply" : placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !picker) {
              event.preventDefault();
              if (!empty && !offReason) onSend?.();
            }
          }}
          className="min-h-13.5 w-full resize-y rounded-ctl border border-line-strong bg-surf-field px-2.5 py-2 text-body-sm leading-[1.45] text-fg outline-none placeholder:text-fg-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        />
        {picker}
      </div>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-caption text-fg-dim">{hint}</span>
        <Button
          variant="primary"
          size="sm"
          disabled={empty || Boolean(offReason)}
          title={offReason ?? (empty ? "Write a comment first" : undefined)}
          onClick={onSend}
        >
          {replyingTo ? "Reply" : sendLabel} <Keycap keys="↵" size="sm" />
        </Button>
      </div>
    </div>
  );
}

export {
  CommentComposer,
  type CommentComposerProps,
  CommentItem,
  type CommentMessage,
  CommentThread,
  type CommentThreadProps,
  type MentionOption,
  MentionPicker,
  type MentionPickerProps,
  MentionText,
};
