import type { TaskDisplay } from "@parfocal/api-client";
import {
  DisplayPanel,
  type DisplaySettings,
  defaultDisplaySettings,
} from "@parfocal/ui/components/display-panel";

const lockedWords: Record<string, Record<string, string>> = {
  order: { ai: "AI order", size: "Largest first", leastsure: "Least sure first", random: "Random" },
  confidence: { number: "Number", word: "Word", color: "Color", hidden: "Hidden" },
};

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

export type DisplayLock = { setting: string; value: string; reason: string };

export function displayLocks(display: TaskDisplay | undefined, extra: DisplayLock[] = []) {
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
        value: lockedWords[lock.setting]?.[lock.value] ?? lock.value,
        reason: `Locked by ${display?.task_code ?? "the task"}: ${lowerFirst(lock.reason)}`,
      },
    ]),
  );
}

export function displaySettings(
  display: TaskDisplay | undefined,
  preset: string | null,
  locks: DisplayLock[] = [],
): DisplaySettings {
  const picked = display?.presets.find((item) => item.name === preset)?.settings ?? {};
  const locked = Object.fromEntries(locks.map((lock) => [lock.setting, lock.value]));
  return { ...defaultDisplaySettings, ...picked, ...locked };
}

type DisplayTabProps = {
  display: TaskDisplay | undefined;
  preset: string | null;
  extraLocks: DisplayLock[];
  viewer?: boolean;
};

export function DisplayTab({ display, preset, extraLocks, viewer = false }: DisplayTabProps) {
  const settings = displaySettings(display, preset, extraLocks);
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
        preset={{
          current: preset ?? "Task default",
          presets: (display?.presets ?? []).map((item) => ({ name: item.name, key: item.key })),
        }}
      />
    </div>
  );
}
