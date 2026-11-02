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
import { SegmentedControl, type SegmentOption } from "@parfocal/ui/components/segmented-control";
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

const displayOptions: Record<string, SegmentOption[]> = {
  draw: [
    { value: "outline", label: "Outline" },
    { value: "fill", label: "Fill" },
    { value: "dots", label: "Dots" },
  ],
  width: [
    { value: "1", label: "1 px" },
    { value: "2", label: "2 px" },
    { value: "3", label: "3 px" },
  ],
  colorBy: [
    { value: "class", label: "Class" },
    { value: "score", label: "Score" },
    { value: "decision", label: "Decision" },
  ],
  confidence: [
    { value: "number", label: "Number" },
    { value: "word", label: "Word" },
    { value: "color", label: "Color" },
    { value: "hidden", label: "Hidden" },
  ],
  order: [
    { value: "ai", label: "AI order" },
    { value: "size", label: "Largest first" },
    { value: "leastsure", label: "Least sure first" },
    { value: "random", label: "Random" },
  ],
  zoom: [
    { value: "fit", label: "Fit" },
    { value: "tight", label: "Tight" },
    { value: "context", label: "Context" },
  ],
  buttons: [
    { value: "right", label: "In the card" },
    { value: "bottom", label: "Under the slide" },
  ],
};

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
  return typeof label === "string" ? label : value;
}

function displaySummary(zone: "draw" | "ai" | "move", settings: DisplaySettings) {
  if (zone === "draw") {
    return `${word("draw", settings.draw)} ${settings.width} px · by ${settings.colorBy}${settings.opacity < 100 ? ` · ${settings.opacity}%` : ""} · IDs ${settings.ids ? "on" : "off"}`;
  }
  if (zone === "ai") {
    return `Confidence as a ${settings.confidence} · ${settings.heatmap ? `heatmap ${settings.heatmap}%` : "heatmap off"} · cutoff ${settings.cutoff.toFixed(2)}`;
  }
  return `${word("order", settings.order)} · ${settings.zoom} · ${settings.auto ? "moves on by itself" : "stays after an answer"}`;
}

function SegRow({
  label,
  name,
  value,
  lock,
}: {
  label: string;
  name: string;
  value: string;
  lock?: Lock | undefined;
}) {
  return (
    <ControlRow label={label} locked={lock}>
      {(labelId) => (
        <SegmentedControl
          aria-labelledby={labelId}
          fill
          wrap={name === "order"}
          defaultValue={value}
          options={displayOptions[name] ?? []}
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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  help?: string;
}) {
  return (
    <ControlRow label={label} help={help}>
      {() => (
        <span className="flex items-center gap-3">
          <Slider
            className="w-60"
            defaultValue={value}
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

function SwitchRow({ label, sub, checked }: { label: string; sub: string; checked: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-caption font-semibold text-fg-dim">{label}</span>
        <small className="mt-0.5 block text-caption text-fg-dim">{sub}</small>
      </span>
      <Switch defaultChecked={checked} />
    </label>
  );
}

type Preset = { name: string; key?: string };

type PresetMenuProps = {
  current: string;
  presets: Preset[];
  changed?: boolean;
  lockedCount?: number;
  defaultOpen?: boolean | undefined;
  onPick?: ((name: string) => void) | undefined;
  onSaveAs?: (() => void) | undefined;
  onReset?: (() => void) | undefined;
};

function PresetMenu({
  current,
  presets,
  changed = false,
  lockedCount = 0,
  defaultOpen,
  onPick,
  onSaveAs,
  onReset,
}: PresetMenuProps) {
  return (
    <div className="grid gap-1.5">
      <span className="text-caption font-semibold text-fg-dim">Preset</span>
      <DropdownMenu {...(defaultOpen === undefined ? {} : { defaultOpen })}>
        <DropdownMenuTrigger render={<Button className="w-full justify-between font-medium" />}>
          <span className="min-w-0 truncate">
            {current}
            {lockedCount ? (
              <span className="text-fg-dim">
                {" "}
                · {lockedCount === 1 ? "1 setting" : `${lockedCount} settings`} locked by the task
              </span>
            ) : null}
          </span>
          {changed ? (
            <i
              title="Changed since you picked it"
              aria-label="Changed since you picked it"
              role="img"
              className="ml-auto size-2 rounded-full bg-(--accent)"
            />
          ) : null}
          <Icon name="down" className="text-fg-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72">
          <DropdownMenuRadioGroup value={current} onValueChange={(name) => onPick?.(String(name))}>
            <DropdownMenuRadioItem value="Task default">
              Task default
              <DropdownMenuShortcut>
                <Keycap keys="⇧1" size="sm" />
              </DropdownMenuShortcut>
            </DropdownMenuRadioItem>
            <DropdownMenuGroup>
              <DropdownMenuLabel>My presets</DropdownMenuLabel>
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
          <DropdownMenuItem disabled={!changed}>
            <span className="grid">
              Save
              {changed ? null : <small className="text-caption text-fg-dim">Nothing changed</small>}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSaveAs}>Save as</DropdownMenuItem>
          <DropdownMenuItem onClick={onReset}>Reset to the task default</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {changed ? (
        <small className="text-caption text-fg-dim">
          Changed since you picked {current}. Save as keeps it as a preset.
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
  after?: React.ReactNode;
};

function DisplayPanel({
  settings = defaultDisplaySettings,
  locks = {},
  folded = [],
  preset = { current: "Task default", presets: [{ name: "Tumor first", key: "⇧2" }] },
  viewer = false,
  resultSets,
  after,
  className,
  ...props
}: DisplayPanelProps) {
  return (
    <Zones data-slot="display-panel" className={cn("gap-3", className)} {...props}>
      <Zone>
        <PresetMenu {...preset} />
      </Zone>
      <FoldingZone
        title="How objects draw"
        summary={displaySummary("draw", settings)}
        defaultOpen={!folded.includes("draw")}
      >
        <SegRow label="Draw as" name="draw" value={settings.draw} lock={locks.draw} />
        <SegRow label="Width" name="width" value={settings.width} lock={locks.width} />
        <RangeRow
          label="Opacity"
          value={settings.opacity}
          min={20}
          max={100}
          step={10}
          format={(value) => `${value}%`}
        />
        <SegRow label="Color by" name="colorBy" value={settings.colorBy} lock={locks.colorBy} />
        <SwitchRow label="ID labels" sub="The ID tags on the slide" checked={settings.ids} />
      </FoldingZone>
      <FoldingZone
        title="What the AI shows"
        summary={displaySummary("ai", settings)}
        defaultOpen={!folded.includes("ai")}
      >
        <SegRow
          label="Confidence"
          name="confidence"
          value={settings.confidence}
          lock={locks.confidence}
        />
        <RangeRow
          label="Heatmap"
          value={settings.heatmap}
          min={0}
          max={100}
          step={10}
          format={(value) => (value ? `${value}%` : "Off")}
        />
        <RangeRow
          label="Score cutoff"
          value={settings.cutoff}
          min={0}
          max={1}
          step={0.05}
          format={(value) => value.toFixed(2)}
          help="Objects under it draw dashed and faint"
        />
        {resultSets ? (
          <div className="grid gap-2">
            <span className="text-caption font-semibold text-fg-dim">Result sets</span>
            {resultSets}
          </div>
        ) : null}
      </FoldingZone>
      <FoldingZone
        title="How the review moves"
        summary={displaySummary("move", settings)}
        defaultOpen={!folded.includes("move")}
      >
        {viewer ? (
          <p className="m-0 text-body-sm text-fg-dim">These apply in guided review.</p>
        ) : null}
        <SegRow label="Order" name="order" value={settings.order} lock={locks.order} />
        <SegRow
          label="Zoom around the object"
          name="zoom"
          value={settings.zoom}
          lock={locks.zoom}
        />
        <SwitchRow
          label="Move on by itself"
          sub="The next object comes after an answer"
          checked={settings.auto}
        />
        <SegRow
          label="Answer buttons"
          name="buttons"
          value={settings.buttons}
          lock={locks.buttons}
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
};
