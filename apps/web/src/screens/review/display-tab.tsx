import {
  DisplayPanel,
  type DisplaySettings,
  defaultDisplaySettings,
} from "@parfocal/ui/components/display-panel";
import type { ReactNode } from "react";
import { useLabDecisionCutoff } from "../../shell/resolved-settings.ts";
import type { TaskDisplayView } from "./display-model.ts";

const lockedWords: Record<string, Record<string, string>> = {
  order: { ai: "AI order", size: "Largest first", leastsure: "Least sure first", random: "Random" },
  confidence: { number: "Number", word: "Word", color: "Color", hidden: "Hidden" },
};

const lockedNumbers: Record<string, (value: number) => string> = {
  heatmap: (value) => (value ? `${value}%` : "Off"),
  cutoff: (value) => value.toFixed(2),
};

const lockedText = (setting: string, value: string) => {
  const number = Number(value);
  const format = lockedNumbers[setting];
  if (format && value !== "" && !Number.isNaN(number)) return format(number);
  return lockedWords[setting]?.[value] ?? value;
};

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

export type DisplayLock = { setting: string; value: string; reason: string };

export function displayLocks(display: TaskDisplayView | undefined, extra: DisplayLock[] = []) {
  const all = [
    ...(display?.locks ?? []).map((lock) => ({
      setting: lock.setting,
      value: String(lock.value),
      reason: lock.reason,
    })),
    ...extra,
  ];
  return Object.fromEntries(
    all.map((lock) => [
      lock.setting,
      {
        value: lockedText(lock.setting, lock.value),
        reason: `Locked by ${display?.task_code ?? "the task"}: ${lowerFirst(lock.reason)}`,
      },
    ]),
  );
}

export function displaySettings(
  display: TaskDisplayView | undefined,
  preset: string | null,
  locks: DisplayLock[] = [],
  confidence?: string,
  labCutoff?: number,
): DisplaySettings {
  const picked = display?.presets.find((item) => item.name === preset)?.settings ?? {};
  const locked = Object.fromEntries(locks.map((lock) => [lock.setting, lock.value]));
  return {
    ...defaultDisplaySettings,
    ...(display?.defaults ?? {}),
    ...(labCutoff === undefined ? {} : { cutoff: labCutoff }),
    ...(confidence === undefined ? {} : { confidence }),
    ...picked,
    ...locked,
  };
}

export function withOverrides(
  base: DisplaySettings,
  overrides: Partial<DisplaySettings>,
  display: TaskDisplayView | undefined,
  extra: DisplayLock[] = [],
): DisplaySettings {
  const locked = new Set([
    ...(display?.locks ?? []).map((lock) => lock.setting),
    ...extra.map((lock) => lock.setting),
  ]);
  const allowed = Object.entries(overrides).filter(([key]) => !locked.has(key));
  return { ...base, ...Object.fromEntries(allowed) };
}

type DisplayTabProps = {
  display: TaskDisplayView | undefined;
  preset: string | null;
  extraLocks: DisplayLock[];
  confidence?: string;
  viewer?: boolean;
  resultSets?: ReactNode;
  after?: ReactNode;
  presetOpen?: boolean;
  changed?: boolean;
  saveBlocked?: string | undefined;
  onSave?: () => void;
  onPresetPick?: (name: string | null) => void;
  onSaveAs?: () => void;
  idLabels?: { on: boolean; onChange: (on: boolean) => void };
  overrides?: Partial<DisplaySettings>;
  onSettingChange?: (key: keyof DisplaySettings, value: string | number | boolean) => void;
  classVisibility?: ReactNode;
};

export function DisplayTab({
  display,
  preset,
  extraLocks,
  confidence,
  viewer = false,
  resultSets,
  after,
  presetOpen,
  changed = false,
  saveBlocked,
  onSave,
  onPresetPick,
  onSaveAs,
  idLabels,
  overrides = {},
  onSettingChange,
  classVisibility,
}: DisplayTabProps) {
  const picked = withOverrides(
    displaySettings(display, preset, extraLocks, confidence, useLabDecisionCutoff()),
    overrides,
    display,
    extraLocks,
  );
  const settings = idLabels ? { ...picked, ids: idLabels.on } : picked;
  return (
    <div className="grid gap-3">
      <p className="m-0 text-body-sm text-fg-dim">
        Only for you, on {display?.task_code ?? "this task"}. Every change redraws the slide at
        once.
      </p>
      <DisplayPanel
        key={`${preset ?? "task"}-${extraLocks.length}`}
        settings={settings}
        locks={displayLocks(display, extraLocks)}
        viewer={viewer}
        resultSets={resultSets}
        after={after}
        classVisibility={classVisibility}
        {...(onSettingChange ? { onSettingChange } : {})}
        {...(idLabels
          ? { onIdsChange: idLabels.onChange }
          : onSettingChange
            ? { onIdsChange: (on: boolean) => onSettingChange("ids", on) }
            : {})}
        preset={{
          current: preset ?? "Task default",
          presets: (display?.presets ?? []).map((item) => ({ name: item.name, key: item.key })),
          defaultOpen: presetOpen,
          changed,
          saveBlocked,
          onSave,
          onPick: (name) => onPresetPick?.(name === "Task default" ? null : name),
          onSaveAs,
          onReset: () => onPresetPick?.(null),
        }}
      />
    </div>
  );
}
