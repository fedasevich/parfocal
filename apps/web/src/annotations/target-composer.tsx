import { Trans, useLingui } from "@lingui/react/macro";
import { CommentComposer } from "@parfocal/ui/components/comment-thread";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useLayerNames } from "./comment-bus.ts";
import { type CommentTarget, targetLabel } from "./comment-target.ts";
import type { AnnotationDocument } from "./document.ts";
import { drawnObjectIds, useSavedCodes } from "./drawn-object-ids.ts";
import type { Point } from "./polygon-draft.ts";

type Reference = { readonly id: string; readonly text: string; readonly sub: string };

const referenceQuery = (text: string) => text.match(/(^|\s)#([^\s#]{0,40})$/)?.[2];

function useReferences(doc: AnnotationDocument, text: string): Reference[] {
  const names = useLayerNames();
  const codes = useSavedCodes();
  const query = referenceQuery(text);
  if (query === undefined) return [];
  const wanted = query.toLowerCase();
  const layers = names.map((item) => ({
    id: item.key,
    text: `#${item.name}`,
    sub: item.key.startsWith("g:") ? "Group" : "Class layer",
  }));
  const objects =
    codes === undefined
      ? []
      : [...drawnObjectIds(doc, codes).values()]
          .filter((item) => item.number !== null)
          .map((item) => ({ id: item.shown, text: item.shown, sub: "Object" }));
  return [...layers, ...objects]
    .filter((item) => item.text.toLowerCase().replace("#", "").includes(wanted))
    .slice(0, 8);
}

export function TargetComposer({
  target,
  doc,
  at,
  offReason,
  failed,
  busy,
  onSend,
  onCancel,
  onPinInstead,
}: {
  target: CommentTarget;
  doc: AnnotationDocument;
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
  const [active, setActive] = useState(0);
  const section = useRef<HTMLElement | null>(null);
  const references = useReferences(doc, text);
  const label = targetLabel(target);
  const point = target.kind === "point";
  useEffect(() => {
    section.current?.querySelector("textarea")?.focus();
  }, []);
  const pick = (reference: Reference | undefined) => {
    if (reference === undefined) return;
    setText(text.replace(/#[^\s#]{0,40}$/, `${reference.text} `));
    setActive(0);
  };
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
        onPickerKey={(key) => {
          if (key === "Escape") {
            setText(`${text} `);
            return;
          }
          if (key === "ArrowDown" || key === "ArrowUp") {
            const step = key === "ArrowDown" ? 1 : references.length - 1;
            setActive((active + step) % Math.max(1, references.length));
            return;
          }
          pick(references[Math.min(active, references.length - 1)]);
        }}
        picker={
          references.length === 0 ? undefined : (
            <div
              role="listbox"
              aria-label={t`Objects and layers`}
              data-testid="reference-picker"
              className="grid gap-0.5 rounded-ctl border border-line bg-chrome p-1 shadow-pop"
            >
              {references.map((reference, index) => (
                <div
                  key={reference.id}
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    pick(reference);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-body-sm",
                    index === active && "bg-accent-soft",
                  )}
                >
                  <span className="truncate font-mono">{reference.text}</span>
                  <small className="text-caption text-fg-dim">{reference.sub}</small>
                </div>
              ))}
            </div>
          )
        }
      />
      {failed ? (
        <p role="alert" className="m-0 text-body-sm text-bad">
          <Trans>The thread did not save. Try again.</Trans>
        </p>
      ) : null}
    </section>
  );
}
