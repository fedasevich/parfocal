import { useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { SegmentedControl, type SegmentOption } from "@parfocal/ui/components/segmented-control";
import { PreviewOption, type SettingPreviewKind } from "@parfocal/ui/components/setting-preview";
import { Slider } from "@parfocal/ui/components/slider";
import type { Range } from "../../devices/calibration.ts";

const options = (pairs: [string, string][], preview?: SettingPreviewKind): SegmentOption[] =>
  pairs.map(([value, label]) => ({
    value,
    label:
      preview === undefined ? label : <PreviewOption kind={preview} option={value} label={label} />,
  }));

export function Segments({
  label,
  value,
  pairs,
  preview,
  onChange,
}: {
  label: string;
  value: string;
  pairs: [string, string][];
  preview?: SettingPreviewKind;
  onChange: (value: string) => void;
}) {
  return (
    <SegmentedControl
      fill
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(String(next))}
      options={options(pairs, preview)}
    />
  );
}

export function Stepper({
  label,
  value,
  unit,
  range,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  range: Range;
  onChange: (value: number) => void;
}) {
  const { t } = useLingui();

  const step = (delta: number) => onChange(Math.max(range.min, Math.min(range.max, value + delta)));
  return (
    <div className="flex items-center gap-2.5">
      <Button size="icon-sm" aria-label={t`Lower ${label}`} onClick={() => step(-range.step)}>
        <Icon name="minus" size="xs" />
      </Button>
      <Slider
        className="data-[orientation=horizontal]:w-[180px]"
        min={range.min}
        max={range.max}
        step={range.step}
        value={[value]}
        getAriaLabel={() => label}
        onValueChange={(next: number | readonly number[]) =>
          onChange(typeof next === "number" ? next : (next[0] ?? value))
        }
      />
      <Button size="icon-sm" aria-label={t`Raise ${label}`} onClick={() => step(range.step)}>
        <Icon name="plus" size="xs" />
      </Button>
      <span className="min-w-10 font-mono text-body-sm text-fg">
        {value}
        {unit}
      </span>
    </div>
  );
}
