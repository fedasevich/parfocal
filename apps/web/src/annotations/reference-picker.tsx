import { useLingui } from "@lingui/react/macro";
import type { PickerKey } from "@parfocal/ui/components/comment-thread";
import { cn } from "@parfocal/ui/lib/utils";
import { type ReactNode, useState } from "react";
import { useLayerNames } from "./comment-bus.ts";
import {
  type Reference,
  referenceQuery,
  useReferenceList,
  withReference,
} from "./comment-references.ts";

const shownAtOnce = 8;

export function useReferenceOptions(text: string): Reference[] {
  const names = useLayerNames();
  const listed = useReferenceList();
  const query = referenceQuery(text);
  if (query === undefined) return [];
  const wanted = query.toLowerCase();
  const layers: Reference[] = names.map((item) => ({
    id: item.key,
    text: `#${item.name}`,
    sub: item.key.startsWith("g:") ? "Group" : "Class layer",
    reach: { kind: "layer", key: item.key },
  }));
  return [...layers, ...listed]
    .filter((item) => item.text.toLowerCase().replace("#", "").includes(wanted))
    .slice(0, shownAtOnce);
}

function ReferencePicker({
  references,
  active,
  onPick,
}: {
  references: readonly Reference[];
  active: number;
  onPick: (reference: Reference) => void;
}) {
  const { t } = useLingui();
  return (
    <div
      role="listbox"
      aria-label={t`Objects, layers and slides`}
      data-testid="reference-picker"
      className="grid gap-0.5 rounded-ctl border border-line bg-chrome p-1 shadow-pop"
    >
      {references.map((reference, index) => (
        <div
          key={`${reference.sub}:${reference.id}`}
          role="option"
          aria-selected={index === active}
          tabIndex={-1}
          onPointerDown={(event) => {
            event.preventDefault();
            onPick(reference);
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
  );
}

export type ReferencePicking = {
  readonly picker: ReactNode | undefined;
  readonly onPickerKey: (key: PickerKey) => void;
};

export function useReferencePicking(
  text: string,
  setText: (next: string) => void,
): ReferencePicking | null {
  const references = useReferenceOptions(text);
  const [active, setActive] = useState(0);
  if (references.length === 0) return null;
  const chosen = Math.min(active, references.length - 1);
  const pick = (reference: Reference | undefined) => {
    if (reference === undefined) return;
    setText(withReference(text, reference));
    setActive(0);
  };
  return {
    picker: <ReferencePicker references={references} active={chosen} onPick={pick} />,
    onPickerKey: (key) => {
      if (key === "Escape") {
        setText(`${text} `);
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        const step = key === "ArrowDown" ? 1 : references.length - 1;
        setActive((chosen + step) % references.length);
        return;
      }
      pick(references[chosen]);
    },
  };
}
