import { Button } from "@parfocal/ui/components/button";
import {
  CommentComposer,
  type CommentMessage,
  CommentThread,
} from "@parfocal/ui/components/comment-thread";
import { IconButton } from "@parfocal/ui/components/icon-button";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type ThreadMeasurement = {
  label: string;
  values: { name: string; value: string }[];
};

function MeasurementEmbed({ measurement }: { measurement: ThreadMeasurement }) {
  return (
    <figure
      data-slot="thread-measurement"
      className="m-0 grid gap-1 rounded-ctl border border-line bg-chrome-2 px-2.5 py-2"
    >
      <figcaption className="text-caption font-semibold text-fg-dim">
        {measurement.label}
      </figcaption>
      <dl className="m-0 flex flex-wrap gap-x-4 gap-y-0.5 text-body-sm">
        {measurement.values.map((entry) => (
          <div key={entry.name} className="flex items-baseline gap-1.5">
            <dt className="text-fg-dim">{entry.name}</dt>
            <dd className="m-0 font-mono font-semibold text-fg">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

type ThreadPopoverProps = Omit<React.ComponentProps<"section">, "title" | "children"> & {
  title: string;
  resolved: boolean;
  messages: CommentMessage[];
  measurement?: ThreadMeasurement | undefined;
  loading?: boolean;
  failed?: boolean;
  busy?: boolean;
  reply: string;
  onReplyChange: (value: string) => void;
  onSend: () => void;
  offReason?: string | undefined;
  onToggleResolved: () => void;
  onClose: () => void;
};

function ThreadPopover({
  title,
  resolved,
  messages,
  measurement,
  loading = false,
  failed = false,
  busy = false,
  reply,
  onReplyChange,
  onSend,
  offReason,
  onToggleResolved,
  onClose,
  className,
  onKeyDown,
  ...props
}: ThreadPopoverProps) {
  return (
    <section
      data-slot="thread-popover"
      data-resolved={resolved}
      aria-label={`Thread: ${title}`}
      className={cn(
        "grid w-80 gap-3 rounded-zone border border-line-strong bg-chrome p-3 shadow-pop",
        className,
      )}
      {...props}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="flex items-start gap-2">
        <h3 className="m-0 min-w-0 flex-1 text-body font-semibold leading-snug text-fg">{title}</h3>
        <Button size="sm" variant={resolved ? "secondary" : "primary"} onClick={onToggleResolved}>
          {resolved ? "Reopen" : "Resolve"}
        </Button>
        <IconButton icon="close" label="Close thread" size="sm" onClick={onClose} />
      </header>
      {resolved ? (
        <p role="status" className="m-0 text-caption text-fg-dim">
          Resolved. Reopen it to keep talking.
        </p>
      ) : null}
      {measurement ? <MeasurementEmbed measurement={measurement} /> : null}
      <div className="max-h-64 overflow-y-auto pr-1">
        {loading ? (
          <p role="status" className="m-0 text-body-sm text-fg-dim">
            Loading the messages
          </p>
        ) : (
          <CommentThread messages={messages} />
        )}
      </div>
      <CommentComposer
        value={reply}
        onValueChange={onReplyChange}
        onSend={onSend}
        label="Reply to this thread"
        placeholder="Write a reply"
        sendLabel="Reply"
        hint="Enter posts, Shift+Enter adds a line"
        offReason={offReason ?? (busy ? "Posting your reply" : undefined)}
      />
      {failed ? (
        <p role="alert" className="m-0 text-body-sm text-bad">
          That did not save. Try again.
        </p>
      ) : null}
    </section>
  );
}

export { MeasurementEmbed, type ThreadMeasurement, ThreadPopover, type ThreadPopoverProps };
