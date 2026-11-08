import { bandColour, type ConfidenceChip } from "./ai-wording.ts";

export function ConfidenceByColour({ chip }: { chip: ConfidenceChip | null | undefined }) {
  if (chip?.form !== "color") return null;
  return (
    <span
      data-slot="confidence-chip"
      data-form="color"
      data-band={chip.band}
      role="img"
      aria-label={`Confidence by colour: ${chip.text}`}
      title={`Confidence by colour: ${chip.text}`}
      className="inline-flex w-fit items-center gap-2 text-caption text-fg-dim"
    >
      <i
        aria-hidden="true"
        className="size-3 rounded-full border border-line"
        style={{ background: bandColour(chip.band) }}
      />
      Confidence
    </span>
  );
}
