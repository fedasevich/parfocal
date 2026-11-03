import { BrightnessPopover } from "@parfocal/ui/components/brightness-popover";
import {
  type BarSignals,
  calmBar,
  formatMagnification,
  formatReadout,
  isBarOpen,
  type MagnificationLabel,
  type MagnificationPreset,
  magnificationPresets,
  msUntilFold,
  nearestMagnificationPreset,
} from "@parfocal/ui/lib/magnification-bar";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

type MagnificationBarProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  magnification: number;
  scaleLabel: string;
  scalePx: number;
  micronsPerPixel: number;
  digital?: boolean;
  labelAs?: MagnificationLabel;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  altHeld?: boolean;
  zoomStamp?: number;
  onPreset?: (preset: MagnificationPreset) => void;
  brightness?: number;
  onBrightnessChange?: (value: number) => void;
};

const nearestPreset = nearestMagnificationPreset;

const slide =
  "flex items-center gap-2.5 overflow-hidden whitespace-nowrap motion-safe:transition-[max-width,opacity,margin] motion-safe:duration-[280ms] motion-safe:ease-out";

function useBarSignals(
  {
    altHeld = false,
    zoomStamp,
    open,
  }: Pick<MagnificationBarProps, "altHeld" | "zoomStamp" | "open">,
  onOpenChange: ((open: boolean) => void) | undefined,
) {
  const [signals, setSignals] = React.useState<BarSignals>(calmBar);
  const [now, setNow] = React.useState(0);
  const seenStamp = React.useRef(zoomStamp);

  React.useEffect(() => {
    if (zoomStamp === seenStamp.current) return;
    seenStamp.current = zoomStamp;
    if (zoomStamp === undefined) return;
    const at = performance.now();
    setNow(at);
    setSignals((previous) => ({ ...previous, zoomedAt: at }));
  }, [zoomStamp]);

  const effective: BarSignals = { ...signals, altHeld };
  const remaining = msUntilFold(effective, now);
  React.useEffect(() => {
    if (remaining === null) return;
    const timer = setTimeout(() => setNow(performance.now()), remaining + 1);
    return () => clearTimeout(timer);
  }, [remaining]);

  const computed = isBarOpen(effective, now);
  const shown = open ?? computed;
  const reported = React.useRef(shown);
  React.useEffect(() => {
    if (reported.current === shown) return;
    reported.current = shown;
    onOpenChange?.(shown);
  }, [shown, onOpenChange]);

  const patch = (change: Partial<BarSignals>) =>
    setSignals((previous) => ({ ...previous, ...change }));
  return { shown, patch };
}

function MagnificationBar({
  magnification,
  scaleLabel,
  scalePx,
  micronsPerPixel,
  digital = false,
  labelAs = "objective",
  open,
  onOpenChange,
  altHeld,
  zoomStamp,
  onPreset,
  brightness = 100,
  onBrightnessChange,
  className,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  tabIndex = 0,
  ...props
}: MagnificationBarProps) {
  const { shown, patch } = useBarSignals(
    {
      ...(altHeld === undefined ? {} : { altHeld }),
      ...(zoomStamp === undefined ? {} : { zoomStamp }),
      ...(open === undefined ? {} : { open }),
    },
    onOpenChange,
  );
  const near = nearestPreset(magnification);
  const current = formatMagnification(magnification, labelAs);
  const brightnessChanged = brightness !== 100;
  const showBrightness = shown || brightnessChanged;
  return (
    <div
      data-slot="magnification-bar"
      data-open={shown || undefined}
      role="toolbar"
      tabIndex={tabIndex}
      aria-label={`Magnification ${current}, scale ${scaleLabel}. Hover or Alt+1 to Alt+6 for the presets`}
      className={cn(
        "inline-flex min-h-9 items-center rounded-zone border border-line bg-chrome py-1 pr-2.5 whitespace-nowrap text-fg shadow-pop outline-none focus-visible:ring-2 focus-visible:ring-accent motion-safe:transition-[padding] motion-safe:duration-[280ms]",
        shown ? "pl-1.5" : "pl-2.5",
        className,
      )}
      onPointerEnter={(event) => {
        patch({ hover: true });
        onPointerEnter?.(event);
      }}
      onPointerLeave={(event) => {
        patch({ hover: false });
        onPointerLeave?.(event);
      }}
      onFocus={(event) => {
        patch({ focus: true });
        onFocus?.(event);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) patch({ focus: false });
        onBlur?.(event);
      }}
      {...props}
    >
      <span
        data-part="presets"
        inert={!shown}
        className={cn(slide, shown ? "max-w-[340px] opacity-100" : "max-w-0 opacity-0")}
      >
        <span className="flex items-center gap-0.5">
          {magnificationPresets.map((preset, index) => (
            <button
              key={preset}
              type="button"
              title={`Alt+${index + 1}`}
              aria-pressed={preset === near}
              onClick={() => onPreset?.(preset)}
              className="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 font-mono text-caption text-fg-dim hover:text-fg aria-pressed:bg-accent-soft aria-pressed:text-fg"
            >
              {formatMagnification(preset, labelAs)}
            </button>
          ))}
        </span>
        <span aria-hidden="true" className="mr-2.5 h-6 w-px shrink-0 bg-line" />
      </span>
      <span
        data-part="current"
        className={cn(
          "overflow-hidden font-mono text-caption font-semibold motion-safe:transition-[max-width,opacity,margin] motion-safe:duration-[280ms]",
          shown ? "mr-0 max-w-0 opacity-0" : "mr-2.5 max-w-[60px] opacity-100",
        )}
      >
        {current}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i
          aria-hidden="true"
          className="h-1.5 border-x-2 border-b-2 border-fg"
          style={{ width: scalePx }}
        />
        <span className="font-mono text-caption">{scaleLabel}</span>
      </span>
      <span
        data-part="readout"
        inert={!shown}
        className={cn(slide, shown ? "max-w-[200px] opacity-100" : "max-w-0 opacity-0")}
      >
        <span aria-hidden="true" className="ml-2.5 h-6 w-px shrink-0 bg-line" />
        <span className="font-mono text-label text-fg-faint">
          {formatReadout(magnification, digital, micronsPerPixel)}
        </span>
      </span>
      {onBrightnessChange ? (
        <span
          data-part="brightness"
          inert={!showBrightness}
          className={cn(slide, showBrightness ? "max-w-[120px] opacity-100" : "max-w-0 opacity-0")}
        >
          <span aria-hidden="true" className="ml-2.5 h-6 w-px shrink-0 bg-line" />
          <BrightnessPopover
            value={brightness}
            onValueChange={onBrightnessChange}
            onOpenChange={(popoverOpen) => patch({ brightnessOpen: popoverOpen })}
          />
        </span>
      ) : null}
    </div>
  );
}

export { MagnificationBar, type MagnificationBarProps, nearestPreset };
