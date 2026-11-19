import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { ControlRow } from "@parfocal/ui/components/control-row";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Slider } from "@parfocal/ui/components/slider";
import { Switch } from "@parfocal/ui/components/switch";
import { FoldingZone, Zone, Zones } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type Lock = { value: string; reason: string };

type DisplaySettings = {
  draw: string;
  width: string;
  opacity: number;
  colorBy: string;
  ids: boolean;
  confidence: string;
  heatmap: number;
  cutoff: number;
  order: string;
  zoom: string;
  auto: boolean;
  buttons: string;
};

const displayOptions: Record<string, { value: string; label: MessageDescriptor }[]> = {
  draw: [
    { value: "outline", label: msg`Outline` },
    { value: "fill", label: msg`Fill` },
    { value: "dots", label: msg`Dots` },
  ],
  width: [
    { value: "1", label: msg`1 px` },
    { value: "2", label: msg`2 px` },
    { value: "3", label: msg`3 px` },
  ],
  colorBy: [
    { value: "class", label: msg`Class` },
    { value: "score", label: msg`Score` },
    { value: "decision", label: msg`Decision` },
  ],
  confidence: [
    { value: "number", label: msg`Number` },
    { value: "word", label: msg`Word` },
    { value: "color", label: msg`Color` },
    { value: "hidden", label: msg`Hidden` },
  ],
  order: [
    { value: "ai", label: msg`AI order` },
    { value: "size", label: msg`Largest first` },
    { value: "leastsure", label: msg`Least sure first` },
    { value: "random", label: msg`Random` },
  ],
  zoom: [
    { value: "fit", label: msg`Fit` },
    { value: "tight", label: msg`Tight` },
    { value: "context", label: msg`Context` },
  ],
  buttons: [
    { value: "right", label: msg`In the card` },
    { value: "bottom", label: msg`Under the slide` },
  ],
};

function snapHeatmapStrength(strength: number): number {
  if (Number.isNaN(strength) || strength < 15) return 0;
  return Math.min(100, Math.max(20, Math.round(strength / 10) * 10));
}

const defaultDisplaySettings: DisplaySettings = {
  draw: "outline",
  width: "2",
  opacity: 100,
  colorBy: "class",
  ids: true,
  confidence: "number",
  heatmap: 0,
  cutoff: 0.4,
  order: "ai",
  zoom: "fit",
  auto: true,
  buttons: "right",
};

function word(key: string, value: string): string {
  const label = displayOptions[key]?.find((option) => option.value === value)?.label;
  return label ? i18n._(label) : value;
}

function displaySummary(zone: "draw" | "ai" | "move", settings: DisplaySettings) {
  if (zone === "draw") {
    return t`${word("draw", settings.draw)} ${settings.width} px · by ${settings.colorBy}${settings.opacity < 100 ? ` · ${settings.opacity}%` : ""} · IDs ${settings.ids ? "on" : "off"}`;
  }
  if (zone === "ai") {
    return t`Confidence as a ${settings.confidence} · ${settings.heatmap ? `heatmap ${settings.heatmap}%` : "heatmap off"} · cutoff ${settings.cutoff.toFixed(2)}`;
  }
  return `${word("order", settings.order)} · ${settings.zoom} · ${settings.auto ? t`moves on by itself` : t`stays after an answer`}`;
}

type SettingChange = (key: keyof DisplaySettings, value: string | number | boolean) => void;

function SegRow({
  label,
  name,
  value,
  lock,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  lock?: Lock | undefined;
  onChange?: SettingChange | undefined;
}) {
  return (
    <ControlRow label={label} locked={lock}>
      {(labelId) => (
        <SegmentedControl
          aria-labelledby={labelId}
          fill
          wrap={name === "order"}
          {...(onChange
            ? {
                value,
                onValueChange: (next: unknown) =>
                  onChange(name as keyof DisplaySettings, String(next)),
              }
            : { defaultValue: value })}
          options={(displayOptions[name] ?? []).map((option) => ({
            ...option,
            label: i18n._(option.label),
          }))}
        />
      )}
    </ControlRow>
  );
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  format,
  help,
  lock,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  help?: string;
  lock?: Lock | undefined;
  onChange?: ((value: number) => void) | undefined;
}) {
  return (
    <ControlRow label={label} help={help} locked={lock}>
      {() => (
        <span className="flex items-center gap-3">
          <Slider
            className="w-60"
            {...(onChange
              ? {
                  value,
                  onValueChange: (next: number | readonly number[]) =>
                    onChange(typeof next === "number" ? next : (next[0] ?? value)),
                }
              : { defaultValue: value })}
            min={min}
            max={max}
            step={step}
            getAriaLabel={() => label}
          />
          <span className="min-w-10 font-mono text-body-sm">{format(value)}</span>
        </span>
      )}
    </ControlRow>
  );
}

function SwitchRow({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange?: ((checked: boolean) => void) | undefined;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-caption font-semibold text-fg-dim">{label}</span>
        <small className="mt-0.5 block text-caption text-fg-dim">{sub}</small>
      </span>
      {onChange ? (
        <Switch checked={checked} onCheckedChange={onChange} />
      ) : (
        <Switch defaultChecked={checked} />
      )}
    </label>
  );
}

type Preset = { name: string; key?: string };

type PresetMenuProps = {
  current: string;
  presets: Preset[];
  changed?: boolean;
  saveBlocked?: string | undefined;
  lockedCount?: number;
  defaultOpen?: boolean | undefined;
  onPick?: ((name: string) => void) | undefined;
  onSave?: (() => void) | undefined;
  onSaveAs?: (() => void) | undefined;
  onReset?: (() => void) | undefined;
};

function PresetMenu({
  current,
  presets,
  changed = false,
  saveBlocked,
  lockedCount = 0,
  defaultOpen,
  onPick,
  onSave,
  onSaveAs,
  onReset,
}: PresetMenuProps) {
  const { t } = useLingui();

  const saveReason = saveBlocked ?? (changed ? undefined : t`Nothing changed`);
  return (
    <div className="grid gap-1.5">
      <span className="text-caption font-semibold text-fg-dim">
        <Trans>Preset</Trans>
      </span>
      <DropdownMenu {...(defaultOpen === undefined ? {} : { defaultOpen })}>
        <DropdownMenuTrigger render={<Button className="w-full justify-between font-medium" />}>
          <span className="min-w-0 truncate">
            {current}
            {lockedCount ? (
              <span className="text-fg-dim">
                {" "}
                · {lockedCount === 1 ? t`1 setting` : t`${lockedCount} settings`}{" "}
                <Trans>locked by the task</Trans>
              </span>
            ) : null}
          </span>
          {changed ? (
            <i
              title={t`Changed since you picked it`}
              aria-label={t`Changed since you picked it`}
              role="img"
              className="ml-auto size-2 rounded-full bg-(--accent)"
            />
          ) : null}
          <Icon name="down" className="text-fg-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72">
          <DropdownMenuRadioGroup value={current} onValueChange={(name) => onPick?.(String(name))}>
            <DropdownMenuRadioItem value={t`Task default`}>
              <Trans>Task default</Trans>
              <DropdownMenuShortcut>
                <Keycap keys="⇧1" size="sm" />
              </DropdownMenuShortcut>
            </DropdownMenuRadioItem>
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <Trans>My presets</Trans>
              </DropdownMenuLabel>
              {presets.map((preset) => (
                <DropdownMenuRadioItem key={preset.name} value={preset.name}>
                  {preset.name}
                  {preset.key ? (
                    <DropdownMenuShortcut>
                      <Keycap keys={preset.key} size="sm" />
                    </DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={saveReason !== undefined} onClick={onSave}>
            <span className="grid">
              <Trans>Save</Trans>
              {saveReason === undefined ? null : (
                <small className="text-caption text-fg-dim">{saveReason}</small>
              )}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSaveAs}>
            <Trans>Save as</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onReset}>
            <Trans>Reset to the task default</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {changed ? (
        <small className="text-caption text-fg-dim">
          <Trans>Changed since you picked {current}. Save as keeps it as a preset.</Trans>
        </small>
      ) : null}
    </div>
  );
}

type DisplayPanelProps = React.ComponentProps<"div"> & {
  settings?: DisplaySettings;
  locks?: Partial<Record<keyof DisplaySettings, Lock>>;
  folded?: Array<"draw" | "ai" | "move">;
  preset?: PresetMenuProps;
  viewer?: boolean;
  resultSets?: React.ReactNode;
  aiExtras?: React.ReactNode;
  after?: React.ReactNode;
  onIdsChange?: (on: boolean) => void;
  onSettingChange?: SettingChange;
  classVisibility?: React.ReactNode;
};

function DisplayPanel({
  settings = defaultDisplaySettings,
  locks = {},
  folded = [],
  preset = { current: t`Task default`, presets: [{ name: "Tumor first", key: "⇧2" }] },
  viewer = false,
  resultSets,
  aiExtras,
  after,
  onIdsChange,
  onSettingChange: onChange,
  classVisibility,
  className,
  ...props
}: DisplayPanelProps) {
  const { t } = useLingui();

  return (
    <Zones data-slot="display-panel" className={cn("gap-3", className)} {...props}>
      <Zone>
        <PresetMenu {...preset} />
      </Zone>
      <FoldingZone
        title={t`How objects draw`}
        summary={displaySummary("draw", settings)}
        defaultOpen={!folded.includes("draw")}
      >
        <SegRow
          label={t`Draw as`}
          name="draw"
          value={settings.draw}
          lock={locks.draw}
          onChange={onChange}
        />
        <SegRow
          label={t`Width`}
          name="width"
          value={settings.width}
          lock={locks.width}
          onChange={onChange}
        />
        <RangeRow
          label={t`Opacity`}
          value={settings.opacity}
          min={20}
          max={100}
          step={10}
          format={(value) => `${value}%`}
          onChange={onChange && ((value) => onChange("opacity", value))}
        />
        <SegRow
          label={t`Color by`}
          name="colorBy"
          value={settings.colorBy}
          lock={locks.colorBy}
          onChange={onChange}
        />
        <SwitchRow
          label={t`ID labels`}
          sub={t`The ID tags on the slide`}
          checked={settings.ids}
          onChange={onIdsChange}
        />
        {classVisibility}
      </FoldingZone>
      <FoldingZone
        title={t`What the AI shows`}
        summary={displaySummary("ai", settings)}
        defaultOpen={!folded.includes("ai")}
      >
        <SegRow
          label={t`Confidence`}
          name="confidence"
          value={settings.confidence}
          lock={locks.confidence}
          onChange={onChange}
        />
        <RangeRow
          label={t`Heatmap`}
          value={settings.heatmap}
          min={0}
          max={100}
          step={10}
          format={(value) => (value ? `${value}%` : "Off")}
          lock={locks.heatmap}
          onChange={onChange && ((value) => onChange("heatmap", snapHeatmapStrength(value)))}
        />
        <RangeRow
          label={t`Score cutoff`}
          value={settings.cutoff}
          min={0}
          max={1}
          step={0.05}
          format={(value) => value.toFixed(2)}
          help={t`Objects under it draw dashed and faint`}
          lock={locks.cutoff}
          onChange={onChange && ((value) => onChange("cutoff", value))}
        />
        {resultSets ? (
          <div className="grid gap-2">
            <span className="text-caption font-semibold text-fg-dim">
              <Trans>Result sets</Trans>
            </span>
            {resultSets}
          </div>
        ) : null}
        {aiExtras}
      </FoldingZone>
      <FoldingZone
        title={t`How the review moves`}
        summary={displaySummary("move", settings)}
        defaultOpen={!folded.includes("move")}
      >
        {viewer ? (
          <p className="m-0 text-body-sm text-fg-dim">
            <Trans>These apply in guided review.</Trans>
          </p>
        ) : null}
        <SegRow
          label={t`Order`}
          name="order"
          value={settings.order}
          lock={locks.order}
          onChange={onChange}
        />
        <SegRow
          label={t`Zoom around the object`}
          name="zoom"
          value={settings.zoom}
          lock={locks.zoom}
          onChange={onChange}
        />
        <SwitchRow
          label={t`Move on by itself`}
          sub={t`The next object comes after an answer`}
          checked={settings.auto}
          onChange={onChange && ((on) => onChange("auto", on))}
        />
        <SegRow
          label={t`Answer buttons`}
          name="buttons"
          value={settings.buttons}
          lock={locks.buttons}
          onChange={onChange}
        />
      </FoldingZone>
      {after}
    </Zones>
  );
}

export {
  DisplayPanel,
  type DisplayPanelProps,
  type DisplaySettings,
  defaultDisplaySettings,
  displaySummary,
  PresetMenu,
  type PresetMenuProps,
  snapHeatmapStrength,
};
