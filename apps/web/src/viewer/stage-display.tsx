import { useLingui } from "@lingui/react/macro";
import { useGetMyDisplay, useGetReviewTask } from "@parfocal/api-client";
import type { DisplaySettings } from "@parfocal/ui/components/display-panel";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { useCallback, useMemo, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { taskDisplayView } from "../screens/review/display-model.ts";
import { DisplayTab, myDisplaySettings } from "../screens/review/display-tab.tsx";
import { useDisplayChoice, useShiftPresetKeys } from "../screens/review/use-display-choice.ts";
import { SavePresetModal } from "../screens/viewer/save-preset-modal.tsx";
import { useLabDecisionCutoff } from "../shell/resolved-settings.ts";
import { showUndoToast } from "../shell/undo-toasts.tsx";
import { DockCard, type InspectorSection } from "./inspector-slots.tsx";
import { type OutlineModeChoice, outlineModeChoices, outlineModeLabels } from "./outline-mode.ts";

type SlotPlacer = (section: InspectorSection, node: HTMLElement | null) => void;

export function useStageDisplay(taskId: string | undefined): DisplaySettings {
  const my = okData(
    useGetMyDisplay(taskId ?? "", { query: { enabled: taskId !== undefined } }).data,
  );
  const labCutoff = useLabDecisionCutoff();
  return useMemo(() => myDisplaySettings(my, labCutoff), [my, labCutoff]);
}

function useSlots(onSlot: SlotPlacer) {
  const sets = useCallback((node: HTMLDivElement | null) => onSlot("sets", node), [onSlot]);
  const ai = useCallback((node: HTMLDivElement | null) => onSlot("ai", node), [onSlot]);
  return {
    resultSets: (
      <div ref={sets} data-testid="display-result-sets" className="grid gap-2 empty:hidden" />
    ),
    aiExtras: <div ref={ai} data-testid="display-ai-extras" className="grid gap-2 empty:hidden" />,
  };
}

function TaskDisplay({
  taskId,
  slideLabel,
  onSlot,
}: {
  taskId: string;
  slideLabel: string;
  onSlot: SlotPlacer;
}) {
  const myDisplay = okData(useGetMyDisplay(taskId).data);
  const taskCode = okData(useGetReviewTask(taskId).data)?.code ?? "";
  const display = useMemo(
    () => (myDisplay ? taskDisplayView(myDisplay, taskCode) : undefined),
    [myDisplay, taskCode],
  );
  const choice = useDisplayChoice({ taskId, display, myDisplay });
  useShiftPresetKeys(display, choice);
  const [saving, setSaving] = useState(false);
  const slots = useSlots(onSlot);
  return (
    <>
      <DisplayTab
        display={display}
        preset={choice.preset}
        extraLocks={[]}
        viewer
        changed={choice.changed}
        saveBlocked={choice.save.reason}
        onSave={choice.saveChanges}
        onPresetPick={choice.pick}
        onSaveAs={() => setSaving(true)}
        overrides={choice.overrides}
        onSettingChange={choice.change}
        {...slots}
      />
      <SavePresetModal
        open={saving}
        slideLabel={slideLabel}
        taskCode={taskCode || "this task"}
        taken={(display?.presets ?? []).map((item) => item.name)}
        onClose={() => setSaving(false)}
        onSave={async (name, scope) => {
          const result = await choice.saveAs(name, scope);
          if (result.status === "saved") {
            setSaving(false);
            showUndoToast({
              message: `Preset ${name} saved.`,
              ...(result.undo ? { undo: result.undo } : {}),
            });
          }
          return result.status;
        }}
      />
    </>
  );
}

function SlotsOnly({ onSlot }: { onSlot: SlotPlacer }) {
  const slots = useSlots(onSlot);
  return (
    <div className="grid gap-2">
      {slots.resultSets}
      {slots.aiExtras}
    </div>
  );
}

export function StageDisplay({
  taskId,
  slideLabel,
  onSlot,
}: {
  taskId: string | null;
  slideLabel: string;
  onSlot: SlotPlacer;
}) {
  return (
    <section data-testid="stage-display">
      {taskId === null ? (
        <SlotsOnly onSlot={onSlot} />
      ) : (
        <TaskDisplay taskId={taskId} slideLabel={slideLabel} onSlot={onSlot} />
      )}
    </section>
  );
}

export function OutlineModeCard({
  mode,
  onMode,
}: {
  mode: OutlineModeChoice;
  onMode: (next: OutlineModeChoice) => void;
}) {
  const { t } = useLingui();
  return (
    <DockCard section="display" order={8}>
      <SegmentedControl
        aria-label={t`Outline display`}
        value={mode}
        onValueChange={(next) => onMode(next as OutlineModeChoice)}
        options={outlineModeChoices.map((choice) => ({
          value: choice,
          label: outlineModeLabels[choice],
        }))}
      />
    </DockCard>
  );
}
