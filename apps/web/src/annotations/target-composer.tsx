import { Trans, useLingui } from "@lingui/react/macro";
import { CommentComposer } from "@parfocal/ui/components/comment-thread";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { useEffect, useRef, useState } from "react";
import { type CommentTarget, targetLabel } from "./comment-target.ts";
import type { Point } from "./polygon-draft.ts";
import { useReferencePicking } from "./reference-picker.tsx";

export function TargetComposer({
  target,
  at,
  offReason,
  failed,
  busy,
  onSend,
  onCancel,
  onPinInstead,
}: {
  target: CommentTarget;
  at: Point;
  offReason: string | undefined;
  failed: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  onPinInstead: (() => void) | undefined;
}) {
  const { t } = useLingui();
  const [text, setText] = useState("");
  const section = useRef<HTMLElement | null>(null);
  const picking = useReferencePicking(text, setText);
  const label = targetLabel(target);
  const point = target.kind === "point";
  useEffect(() => {
    section.current?.querySelector("textarea")?.focus();
  }, []);
  return (
    <section
      ref={section}
      aria-label={point ? t`New pinned thread` : t`New thread on ${label}`}
      data-testid="pin-composer"
      data-target={target.kind}
      className="pointer-events-auto absolute z-10 grid w-72 gap-2 rounded-ctl border border-line bg-chrome p-3 shadow-pop"
      style={{ left: at.x + 12, top: at.y + 12 }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      {point ? null : (
        <div className="flex items-center justify-between gap-2 text-body-sm">
          <span data-testid="comment-target" className="flex min-w-0 items-center gap-1.5">
            <Trans>Comment on</Trans>{" "}
            {target.kind === "object" ? (
              <ObjectIdTag>{label}</ObjectIdTag>
            ) : (
              <b className="truncate font-semibold">{label}</b>
            )}
          </span>
          {onPinInstead ? (
            <button
              type="button"
              onClick={onPinInstead}
              className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-caption font-medium text-accent hover:underline"
            >
              <Trans>Pin the point instead</Trans>
            </button>
          ) : null}
        </div>
      )}
      <CommentComposer
        value={text}
        onValueChange={setText}
        onSend={() => {
          if (!busy) onSend(text);
        }}
        label={point ? t`Comment at the pin` : t`Comment on ${label}`}
        offReason={offReason}
        onPickerKey={picking?.onPickerKey}
        picker={picking?.picker}
      />
      {failed ? (
        <p role="alert" className="m-0 text-body-sm text-bad">
          <Trans>The thread did not save. Try again.</Trans>
        </p>
      ) : null}
    </section>
  );
}
