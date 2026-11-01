import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

const presets = [1.25, 2.5, 5, 10, 20, 40] as const;

type MagnificationBarProps = React.ComponentProps<"div"> & {
  magnification: number;
  scaleLabel: string;
  scalePx: number;
  micronsPerPixel: number;
  open?: boolean;
};

const nearestPreset = (magnification: number) =>
  presets.reduce((best, preset) =>
    Math.abs(Math.log(preset / magnification)) < Math.abs(Math.log(best / magnification))
      ? preset
      : best,
  );

const formatMag = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function MagnificationBar({
  magnification,
  scaleLabel,
  scalePx,
  micronsPerPixel,
  open = false,
  className,
  ...props
}: MagnificationBarProps) {
  const near = nearestPreset(magnification);
  return (
    <div
      data-slot="magnification-bar"
      data-open={open || undefined}
      role="group"
      aria-label={`Magnification ${formatMag(magnification)}×, scale ${scaleLabel}`}
      className={cn(
        "inline-flex min-h-9 items-center gap-2.5 rounded-zone border border-line bg-chrome px-2.5 py-1 whitespace-nowrap text-fg shadow-pop",
        className,
      )}
      {...props}
    >
      {open ? (
        <>
          <span className="flex items-center gap-0.5">
            {presets.map((preset, index) => (
              <button
                key={preset}
                type="button"
                title={`Alt+${index + 1}`}
                aria-pressed={preset === near}
                className="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 font-mono text-caption text-fg-dim hover:text-fg aria-pressed:bg-accent-soft aria-pressed:text-fg"
              >
                {formatMag(preset)}×
              </button>
            ))}
          </span>
          <span aria-hidden="true" className="h-6 w-px bg-line" />
        </>
      ) : (
        <span className="font-mono text-caption font-semibold">{formatMag(magnification)}×</span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <i
          aria-hidden="true"
          className="h-1.5 border-x-2 border-b-2 border-fg"
          style={{ width: scalePx }}
        />
        <span className="font-mono text-caption">{scaleLabel}</span>
      </span>
      {open ? (
        <>
          <span aria-hidden="true" className="h-6 w-px bg-line" />
          <span className="font-mono text-label text-fg-faint">
            {formatMag(magnification)}× · {micronsPerPixel.toFixed(2)} µm/px
          </span>
        </>
      ) : null}
    </div>
  );
}

export { MagnificationBar, type MagnificationBarProps, nearestPreset };
