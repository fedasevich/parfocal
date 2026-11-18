import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Banner } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { cn } from "@parfocal/ui/lib/utils";
import type { NoticeKind, NoticePlan, SaveWord } from "@parfocal/ui/lib/viewer-notices";
import { type ReactNode, useEffect, useId, useRef } from "react";

function waitingText(unsaved: number): string {
  return plural(unsaved, {
    one: "Not connected, # edit waiting to save",
    other: "Not connected, # edits waiting to save",
  });
}

const wordTones: Record<Exclude<SaveWord, null>, string> = {
  saving: "text-fg-dim",
  saved: "text-fg-dim",
  waiting: "text-warn",
  "not-saved": "text-bad",
};

function SaveStatusWord({ word, unsaved }: { word: SaveWord; unsaved: number }) {
  const { t } = useLingui();
  if (word === null) return null;
  const text =
    word === "saving"
      ? t`Saving`
      : word === "saved"
        ? t`All edits saved`
        : word === "waiting"
          ? waitingText(unsaved)
          : t`Some edits were not saved`;
  return (
    <p
      data-testid="save-status"
      data-word={word}
      className={cn("truncate text-body-sm", wordTones[word])}
    >
      {text}
    </p>
  );
}

type ConflictView = {
  readonly id: string;
  readonly title: string;
  readonly preview: ReactNode;
  readonly more: number;
  readonly onKeepMine?: (() => void) | undefined;
  readonly onKeepTheirs: () => void;
};

type ChangesView = {
  readonly text: string;
  readonly onShow: () => void;
};

type ViewerNoticesProps = {
  plan: NoticePlan;
  unsaved: number;
  conflict?: ConflictView | undefined;
  changes?: ChangesView | undefined;
  onRetry: () => void;
  onDismissNotSaved: () => void;
};

function useWaitingLine(waiting: readonly NoticeKind[]): string | null {
  const { t } = useLingui();
  if (waiting.length === 0) return null;
  const names: Record<NoticeKind, string> = {
    conflict: t`an edit conflict`,
    "not-saved": t`edits that were not saved`,
    offline: t`no connection`,
    changes: t`a colleague's new changes`,
  };
  const list = waiting.map((kind) => names[kind]).join(", ");
  return t`Shown next: ${list}.`;
}

function Waiting({ line }: { line: string | null }) {
  if (line === null) return null;
  return (
    <span data-testid="notice-waiting" className="block text-caption text-fg-dim">
      {line}
    </span>
  );
}

function ConflictBanner({ conflict, line }: { conflict: ConflictView; line: string | null }) {
  const titleId = useId();
  const title = useRef<HTMLSpanElement>(null);
  const follow = useRef(false);
  const { id, more } = conflict;
  useEffect(() => {
    if (!follow.current || id === "") return;
    follow.current = false;
    title.current?.focus();
  }, [id]);
  const choose = (run: () => void) => () => {
    follow.current = true;
    run();
  };
  return (
    <Banner
      tone="warn"
      role="group"
      aria-labelledby={titleId}
      data-testid="conflict-notice"
      data-conflict={id}
      className="items-start py-2.5"
      actions={
        <>
          {conflict.onKeepMine === undefined ? null : (
            <Button size="sm" onClick={choose(conflict.onKeepMine)}>
              <Trans>Keep mine</Trans>
            </Button>
          )}
          <Button size="sm" onClick={choose(conflict.onKeepTheirs)}>
            <Trans>Keep theirs</Trans>
          </Button>
        </>
      }
    >
      <span className="flex items-center gap-3">
        {conflict.preview}
        <span className="grid min-w-0 gap-0.5">
          <span
            id={titleId}
            ref={title}
            tabIndex={-1}
            className="block font-medium text-fg outline-none focus-visible:underline"
          >
            {conflict.title}
          </span>
          <span className="block text-caption text-fg-dim">
            <Trans>Yours is the solid blue outline, theirs is the dashed orange one.</Trans>
            {more > 0 ? " " : null}
            {more > 0
              ? plural(more, {
                  one: "# more conflict follows this one.",
                  other: "# more conflicts follow this one.",
                })
              : null}
          </span>
          <Waiting line={line} />
        </span>
      </span>
    </Banner>
  );
}

function useNoticeText(props: ViewerNoticesProps): string {
  const { t } = useLingui();
  const { plan, unsaved, conflict, changes } = props;
  if (plan.shown === "conflict") {
    const title = conflict?.title ?? "";
    return t`${title}. Choose Keep mine or Keep theirs in the banner under the top bar.`;
  }
  if (plan.shown === "not-saved") {
    return t`Some edits were not saved. The server refused them, so a reload shows the last saved version.`;
  }
  if (plan.shown === "offline") {
    const waiting = waitingText(unsaved);
    return t`${waiting}. They stay in this tab and save when the connection returns.`;
  }
  if (plan.shown === "changes") return changes?.text ?? "";
  return "";
}

function ViewerNotices(props: ViewerNoticesProps) {
  const { plan, unsaved, conflict, changes, onRetry, onDismissNotSaved } = props;
  const text = useNoticeText(props);
  const line = useWaitingLine(plan.waiting);
  const groupId = useId();
  return (
    <>
      <p role="alert" data-testid="notice-alert" className="sr-only">
        {plan.urgency === "assertive" ? text : ""}
      </p>
      <p role="status" data-testid="notice-status" className="sr-only">
        {plan.urgency === "polite" ? text : ""}
      </p>
      {plan.shown === "conflict" && conflict !== undefined ? (
        <ConflictBanner conflict={conflict} line={line} />
      ) : null}
      {plan.shown === "not-saved" ? (
        <Banner
          tone="bad"
          role="group"
          aria-labelledby={groupId}
          data-testid="not-saved-notice"
          actions={
            <Button size="sm" onClick={onDismissNotSaved}>
              <Trans>Dismiss</Trans>
            </Button>
          }
        >
          <span id={groupId}>
            <b>
              <Trans>Some edits were not saved.</Trans>
            </b>{" "}
            <Trans>The server refused them, so a reload shows the last saved version.</Trans>
          </span>
          <Waiting line={line} />
        </Banner>
      ) : null}
      {plan.shown === "offline" ? (
        <Banner
          tone="warn"
          role="group"
          aria-labelledby={groupId}
          data-testid="offline-notice"
          actions={
            <Button size="sm" onClick={onRetry}>
              <Trans>Try now</Trans>
            </Button>
          }
        >
          <span id={groupId}>
            <b>{waitingText(unsaved)}.</b>{" "}
            <Trans>They stay in this tab and save when the connection returns.</Trans>
          </span>
          <Waiting line={line} />
        </Banner>
      ) : null}
      {plan.shown === "changes" && changes !== undefined ? (
        <Banner
          tone="info"
          role="group"
          aria-labelledby={groupId}
          data-testid="changes-by"
          actions={
            <Button size="sm" onClick={changes.onShow}>
              <Trans>Show changes</Trans>
            </Button>
          }
        >
          <span id={groupId}>{changes.text}</span>
        </Banner>
      ) : null}
    </>
  );
}

export {
  type ChangesView,
  type ConflictView,
  SaveStatusWord,
  ViewerNotices,
  type ViewerNoticesProps,
};
