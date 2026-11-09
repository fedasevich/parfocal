import type { DisplaySettings as ApiSettings, MyDisplay, TaskDisplay } from "@parfocal/api-client";
import type { DisplaySettings } from "@parfocal/ui/components/display-panel";

export type PanelValues = Partial<DisplaySettings>;

export type TaskDisplayView = TaskDisplay & { defaults?: PanelValues };

const orderToPanel: Record<string, string> = {
  ai: "ai",
  "largest-first": "size",
  "least-sure-first": "leastsure",
  random: "random",
};
const orderToApi = invert(orderToPanel);
const confidenceToPanel: Record<string, string> = { colour: "color" };
const confidenceToApi = invert(confidenceToPanel);
const buttonsToPanel: Record<string, string> = { card: "right", "under-slide": "bottom" };
const buttonsToApi = invert(buttonsToPanel);

function invert(map: Record<string, string>) {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]));
}

const lockToPanel: Record<string, string> = { "score-cutoff": "cutoff" };

export function fromApi(settings: ApiSettings | undefined): PanelValues {
  if (!settings) return {};
  const values: PanelValues = {};
  if (settings.draw_as !== undefined) values.draw = settings.draw_as;
  if (settings.width !== undefined) values.width = String(settings.width);
  if (settings.opacity !== undefined) values.opacity = settings.opacity;
  if (settings.colour_by !== undefined) values.colorBy = settings.colour_by;
  if (settings.id_labels !== undefined) values.ids = settings.id_labels;
  if (settings.confidence !== undefined) {
    values.confidence = confidenceToPanel[settings.confidence] ?? settings.confidence;
  }
  if (settings.heatmap !== undefined) values.heatmap = settings.heatmap;
  if (settings.score_cutoff !== undefined) values.cutoff = settings.score_cutoff;
  if (settings.order !== undefined) values.order = orderToPanel[settings.order] ?? settings.order;
  if (settings.zoom !== undefined) values.zoom = settings.zoom;
  if (settings.move_on !== undefined) values.auto = settings.move_on;
  if (settings.buttons !== undefined) {
    values.buttons = buttonsToPanel[settings.buttons] ?? settings.buttons;
  }
  return values;
}

export function toApi(values: PanelValues): ApiSettings {
  const settings: Record<string, unknown> = {};
  if (values.draw !== undefined) settings["draw_as"] = values.draw;
  if (values.width !== undefined) settings["width"] = Number(values.width);
  if (values.opacity !== undefined) settings["opacity"] = values.opacity;
  if (values.colorBy !== undefined) settings["colour_by"] = values.colorBy;
  if (values.ids !== undefined) settings["id_labels"] = values.ids;
  if (values.confidence !== undefined) {
    settings["confidence"] = confidenceToApi[values.confidence] ?? values.confidence;
  }
  if (values.heatmap !== undefined) settings["heatmap"] = values.heatmap;
  if (values.cutoff !== undefined) settings["score_cutoff"] = values.cutoff;
  if (values.order !== undefined) settings["order"] = orderToApi[values.order] ?? values.order;
  if (values.zoom !== undefined) settings["zoom"] = values.zoom;
  if (values.auto !== undefined) settings["move_on"] = values.auto;
  if (values.buttons !== undefined) {
    settings["buttons"] = buttonsToApi[values.buttons] ?? values.buttons;
  }
  return settings;
}

export const presetKeys = ["⇧2", "⇧3", "⇧4"];

export function taskDisplayView(my: MyDisplay | undefined, taskCode: string): TaskDisplayView {
  const defaults = fromApi(my?.task.defaults);
  const locks = Object.entries(my?.task.locks ?? {}).flatMap(([setting, reason]) => {
    if (reason === undefined) return [];
    const key = lockToPanel[setting] ?? setting;
    const value = (defaults as Record<string, string | number | boolean | undefined>)[key];
    return [{ setting: key, value: value ?? "", reason }];
  });
  return {
    task_id: "",
    task_code: taskCode,
    locks,
    presets: (my?.presets ?? []).map((preset, index) => ({
      name: preset.name,
      key: presetKeys[index] ?? "",
      settings: fromApi(preset.settings) as Record<string, string | number | boolean>,
    })),
    defaults,
  };
}

export function presetBase(display: TaskDisplayView | undefined, preset: string | null) {
  const picked = display?.presets.find((item) => item.name === preset)?.settings ?? {};
  return { ...display?.defaults, ...picked } as PanelValues;
}

export function overridesOf(my: MyDisplay | undefined, display: TaskDisplayView): PanelValues {
  if (!my) return {};
  const base = presetBase(display, my.preset_id === null ? null : my.preset) as Record<
    string,
    unknown
  >;
  const kept = fromApi(my.settings) as Record<string, unknown>;
  const locked = new Set(display.locks.map((lock) => lock.setting));
  return Object.fromEntries(
    Object.entries(kept).filter(([key, value]) => !locked.has(key) && base[key] !== value),
  );
}

export function shiftPreset(
  display: TaskDisplayView | undefined,
  digit: number,
): { name: string | null } | null {
  if (digit === 1) return { name: null };
  const preset = display?.presets[digit - 2];
  return digit >= 2 && digit <= 4 && preset ? { name: preset.name } : null;
}

export function saveState(changed: boolean, preset: string | null) {
  if (!changed) return { enabled: false, reason: "Nothing changed" };
  if (preset === null) {
    return { enabled: false, reason: "Task default can't be changed. Use Save as." };
  }
  return { enabled: true, reason: undefined };
}

export function composeValues(
  display: TaskDisplayView | undefined,
  preset: string | null,
  overrides: PanelValues,
): PanelValues {
  const locked = new Set((display?.locks ?? []).map((lock) => lock.setting));
  const kept = Object.entries({ ...presetBase(display, preset), ...overrides }).filter(
    ([key]) => !locked.has(key),
  );
  const defaults = Object.entries(display?.defaults ?? {}).filter(([key]) => locked.has(key));
  return Object.fromEntries([...kept, ...defaults]);
}
