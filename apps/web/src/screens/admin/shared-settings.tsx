import {
  getGetMySettingLayersQueryKey,
  getGetSessionPolicyQueryKey,
  type LabSettings,
  type SessionPolicy,
  useGetSessionPolicy,
  useSetWorkspaceSettings,
  useUpdateSessionPolicy,
} from "@parfocal/api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { useQueryClient } from "@tanstack/react-query";
import { okData } from "../placeholder.tsx";
import type { Notify } from "./common.tsx";
import {
  classOptions,
  defaultChange,
  defaultsOf,
  durationText,
  idleLockChoices,
  withCurrent,
} from "./workspace-settings-model.ts";

export const defaultEmergencyHours = 4;

export const failure = (error: unknown) =>
  error instanceof Error ? error.message : "That did not save. Try again.";

export function NumberChoice({
  label,
  value,
  choices,
  format,
  onChange,
}: {
  label: string;
  value: number;
  choices: number[];
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger size="sm" aria-label={label} className="w-40">
        <SelectValue>{format(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {withCurrent(choices, value).map((choice) => (
          <SelectItem key={choice} value={String(choice)}>
            {format(choice)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function useSessionPolicy(notify: Notify) {
  const policy = okData(useGetSessionPolicy().data);
  const queryClient = useQueryClient();
  const update = useUpdateSessionPolicy();
  const save = (next: Partial<SessionPolicy>, said: string) => {
    if (policy === undefined) return;
    const before = policy;
    const send = (change: SessionPolicy, message: string, undo?: () => void) =>
      update.mutate(
        {
          data: {
            idle_lock_minutes: change.idle_lock_minutes,
            session_hours: change.session_hours,
            emergency_hours: change.emergency_hours ?? defaultEmergencyHours,
          },
        },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: getGetSessionPolicyQueryKey() });
            notify(message, undo);
          },
          onError: (error) => notify(failure(error)),
        },
      );
    send({ ...before, ...next }, said, () => send(before, "Lock times restored."));
  };
  return { policy, save };
}

export function IdleLockChoice({
  minutes,
  save,
}: {
  minutes: number;
  save: (next: Partial<SessionPolicy>, said: string) => void;
}) {
  return (
    <NumberChoice
      label="Lock after inactivity"
      value={minutes}
      choices={idleLockChoices}
      format={durationText}
      onChange={(value) =>
        save(
          { idle_lock_minutes: value },
          `Screens lock after ${durationText(value)} without activity.`,
        )
      }
    />
  );
}

export function ClassListChoice({
  lab,
  notify,
  label,
}: {
  lab: LabSettings;
  notify: Notify;
  label: string;
}) {
  const queryClient = useQueryClient();
  const save = useSetWorkspaceSettings();
  const current = defaultsOf(lab).classes;
  const apply = (value: string, said: string, undo?: () => void) =>
    save.mutate(
      { data: defaultChange(lab, "default_classes", value) },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() });
          notify(said, undo);
        },
        onError: (error) => notify(failure(error)),
      },
    );
  return (
    <Select
      value={current}
      onValueChange={(value) => {
        const next = String(value);
        if (next === current) return;
        apply(next, "New projects start with that class list.", () =>
          apply(current, "Default restored."),
        );
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-48">
        <SelectValue>{classOptions.find((option) => option.value === current)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {classOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
