import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { Slider } from "@parfocal/ui/components/slider";
import { cn } from "@parfocal/ui/lib/utils";

type BrightnessPopoverProps = {
  value: number;
  onValueChange: (value: number) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
};

const minBrightness = 20;
const maxBrightness = 140;
const stepBrightness = 5;

function BrightnessPopover({
  value,
  onValueChange,
  open,
  onOpenChange,
  defaultOpen,
}: BrightnessPopoverProps) {
  const { t } = useLingui();

  const clamp = (next: number) => Math.min(maxBrightness, Math.max(minBrightness, next));
  const changed = value !== 100;
  return (
    <Popover
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
    >
      <PopoverTrigger
        aria-label={t`Slide brightness ${value}%`}
        title={t`Slide brightness (⌥↑ / ⌥↓)`}
        className={cn(
          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-ctl border border-line-strong bg-btn-bg px-2 text-body-sm text-fg outline-none hover:bg-chrome-3 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
          changed && "border-accent text-accent",
        )}
      >
        <Icon name="sun" />
        <span className="font-mono" aria-hidden="true">
          {value}%
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t`Slide brightness`} className="w-80 gap-3">
        <div className="flex items-center justify-between">
          <b className="text-body-sm font-semibold">
            <Trans>Slide brightness</Trans>
          </b>
          <Button size="sm" variant="ghost" onClick={() => onValueChange(100)} disabled={!changed}>
            <Trans>Reset to 100%</Trans>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            aria-label={t`Dimmer`}
            disabled={value <= minBrightness}
            onClick={() => onValueChange(clamp(value - 10))}
          >
            −
          </Button>
          <Slider
            min={minBrightness}
            max={maxBrightness}
            step={stepBrightness}
            value={value}
            onValueChange={(next: number | readonly number[]) =>
              onValueChange(typeof next === "number" ? next : (next[0] ?? 100))
            }
            getAriaLabel={() => t`Slide brightness`}
          />
          <Button
            size="icon-sm"
            aria-label={t`Brighter`}
            disabled={value >= maxBrightness}
            onClick={() => onValueChange(clamp(value + 10))}
          >
            +
          </Button>
          <span className="min-w-10 text-right font-mono text-body-sm">{value}%</span>
        </div>
        <p className="m-0 text-caption leading-[1.45] text-fg-dim">
          <Trans>
            Like the light dial on a microscope. Changes the slide only, never the interface or the
            monitor's calibration. Remembered on this computer. <Keycap keys="⌥↑" />{" "}
            <Keycap keys="⌥↓" /> <Keycap keys="⌥0" />
          </Trans>
        </p>
      </PopoverContent>
    </Popover>
  );
}

export { BrightnessPopover, type BrightnessPopoverProps };
