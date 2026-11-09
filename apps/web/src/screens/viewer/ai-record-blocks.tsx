import { Zone } from "@parfocal/ui/components/zone";

type LinesBlockProps = { slot: string; title: string; lines: readonly string[]; enabled: boolean };

function LinesBlock({ slot, title, lines, enabled }: LinesBlockProps) {
  if (!enabled || lines.length === 0) return null;
  return (
    <Zone data-slot={slot} aria-label={title} title={title}>
      <ul className="m-0 grid list-none gap-1 p-0 text-body-sm text-fg-dim">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Zone>
  );
}

export function TrackRecordBlock(props: Omit<LinesBlockProps, "slot" | "title">) {
  return <LinesBlock slot="track-record" title="Your track record" {...props} />;
}

export function CalibrationBlock(props: Omit<LinesBlockProps, "slot" | "title">) {
  return <LinesBlock slot="calibration-details" title="Calibration details" {...props} />;
}
