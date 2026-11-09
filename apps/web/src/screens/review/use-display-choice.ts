import {
  ApiError,
  getGetMyDisplayQueryKey,
  type MyDisplay,
  useChangeDisplayPreset,
  useChooseMyDisplay,
  useDeleteDisplayPreset,
  useSaveDisplayPreset,
} from "@parfocal/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useBindings } from "../../keys/personal-keys.ts";
import type { Fired } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";
import { showUndoToast } from "../../shell/undo-toasts.tsx";
import { inLayer } from "./answer-keys.ts";
import {
  composeValues,
  overridesOf,
  type PanelValues,
  presetBase,
  saveState,
  shiftPreset,
  type TaskDisplayView,
  toApi,
} from "./display-model.ts";
import type { ReviewSession } from "./review-data.ts";

export type SaveResult = { status: "saved" | "taken" | "failed"; undo?: () => void };

export type DisplayChoice = {
  preset: string | null;
  overrides: PanelValues;
  changed: boolean;
  save: { enabled: boolean; reason: string | undefined };
  pick: (name: string | null) => void;
  change: (key: keyof PanelValues, value: string | number | boolean) => void;
  saveAs: (name: string, scope: "task" | "all") => Promise<SaveResult>;
  saveChanges: () => void;
  remember: () => () => void;
};

export function useDisplayChoice(
  session: ReviewSession,
  seedPreset: string | null = null,
): DisplayChoice {
  const { taskId, display, myDisplay } = session;
  const queryClient = useQueryClient();
  const chooser = useChooseMyDisplay();
  const preserver = useSaveDisplayPreset();
  const changer = useChangeDisplayPreset();
  const remover = useDeleteDisplayPreset();
  const key = getGetMyDisplayQueryKey(taskId);
  const preset = myDisplay && myDisplay.preset_id !== null ? myDisplay.preset : null;
  const overrides = display && myDisplay ? overridesOf(myDisplay, display) : {};
  const changed = Object.keys(overrides).length > 0;

  const keep = (next: MyDisplay) =>
    queryClient.setQueryData(key, { status: 200, data: next, headers: new Headers() });

  const putRaw = async (presetId: string | null, settings: MyDisplay["settings"]) => {
    if (!myDisplay) return;
    const named = myDisplay.presets.find((item) => item.id === presetId);
    keep({
      ...myDisplay,
      preset_id: presetId,
      preset: named?.name ?? "Task default",
      settings,
    });
    try {
      const result = await chooser.mutateAsync({
        taskId,
        data: { preset_id: presetId, settings },
      });
      if (result.status === 200) keep(result.data);
    } catch {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const put = (presetId: string | null, values: PanelValues) => putRaw(presetId, toApi(values));

  const remember = () => {
    const before = myDisplay;
    return () => {
      if (before) void putRaw(before.preset_id, before.settings);
    };
  };

  const idOf = (name: string | null) =>
    name === null ? null : (myDisplay?.presets.find((item) => item.name === name)?.id ?? null);

  const pick = (name: string | null) => {
    void put(idOf(name), composeValues(display, name, {}));
  };

  const change: DisplayChoice["change"] = (setting, value) => {
    if (display?.locks.some((lock) => lock.setting === setting)) return;
    const base = presetBase(display, preset) as Record<string, unknown>;
    const next = { ...overrides } as Record<string, unknown>;
    if (base[setting] === value) delete next[setting];
    else next[setting] = value;
    void put(idOf(preset), composeValues(display, preset, next));
  };

  const saveAs: DisplayChoice["saveAs"] = async (name, scope) => {
    if (!myDisplay) return { status: "failed" };
    const values = composeValues(display, preset, overrides);
    try {
      const saved = await preserver.mutateAsync({
        data: { name, task_id: scope === "task" ? taskId : null, settings: toApi(values) },
      });
      if (saved.status !== 201) return { status: "failed" };
      keep({
        ...myDisplay,
        presets: [...myDisplay.presets, saved.data],
        preset_id: saved.data.id,
        preset: saved.data.name,
        settings: saved.data.settings,
      });
      await chooser.mutateAsync({
        taskId,
        data: { preset_id: saved.data.id, settings: saved.data.settings },
      });
      void queryClient.invalidateQueries({ queryKey: key });
      const undo = remember();
      return {
        status: "saved",
        undo: () => {
          undo();
          remover.mutate(
            { presetId: saved.data.id },
            { onSettled: () => void queryClient.invalidateQueries({ queryKey: key }) },
          );
        },
      };
    } catch (error) {
      return {
        status:
          error instanceof ApiError && error.problem?.code === "display-preset-name-taken"
            ? "taken"
            : "failed",
      };
    }
  };

  const saveChanges = () => {
    const current = myDisplay?.presets.find((item) => item.name === preset);
    if (!current || !myDisplay) return;
    const values = composeValues(display, preset, overrides);
    changer.mutate(
      { presetId: current.id, data: { settings: toApi(values) } },
      { onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) },
    );
  };

  const seeded = useRef(false);
  const ready = myDisplay !== undefined;
  const standing = preset === null;
  useEffect(() => {
    if (seeded.current || !ready || seedPreset === null || !standing) return;
    seeded.current = true;
    pick(seedPreset);
  });

  return {
    preset,
    overrides,
    changed,
    save: saveState(changed, preset),
    pick,
    change,
    saveAs,
    saveChanges,
    remember,
  };
}

export function useShiftPresetKeys(
  display: TaskDisplayView | undefined,
  choice: Pick<DisplayChoice, "pick" | "remember">,
  enabled = true,
) {
  const bindings = useBindings(["viewer"], ["preset"], enabled);
  useHotkeys(bindings, (fired: Fired) => {
    if (fired.phase !== "press" || inLayer()) return;
    const digit = Number(fired.action.split(":")[1]);
    const target = shiftPreset(display, digit);
    if (target === null) return;
    const undo = choice.remember();
    choice.pick(target.name);
    showUndoToast({ message: `Display: ${target.name ?? "Task default"}`, undo });
  });
}
