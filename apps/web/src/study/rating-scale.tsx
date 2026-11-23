import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import type { ReactNode } from "react";

export function RatingScale({
  count,
  value,
  onChange,
  labelledBy,
  low,
  high,
  testId,
}: {
  count: number;
  value: number | null;
  onChange: (value: number) => void;
  labelledBy: string;
  low?: ReactNode;
  high?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="grid gap-1" data-testid={testId}>
      <RadioGroup
        aria-labelledby={labelledBy}
        value={value === null ? "" : String(value)}
        onValueChange={(next) => onChange(Number(next))}
        className="flex w-full justify-between gap-2"
      >
        {Array.from({ length: count }, (_, index) => {
          const option = String(index + 1);
          return (
            <label
              key={option}
              className="flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-ctl border border-line px-2 py-1.5 text-body-sm text-fg has-data-checked:border-accent has-data-checked:bg-accent-soft"
            >
              <RadioGroupItem value={option} aria-label={option} />
              <span aria-hidden="true">{option}</span>
            </label>
          );
        })}
      </RadioGroup>
      {low === undefined && high === undefined ? null : (
        <div className="flex justify-between text-caption text-fg-dim">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      )}
    </div>
  );
}
