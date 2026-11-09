import {
  getGetRetentionPolicyQueryKey,
  type RetentionPolicy,
  useGetRetentionPolicy,
  useSetRetentionPolicy,
} from "@parfocal/api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Zone } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { okData } from "../placeholder.tsx";
import type { Notify } from "./common.tsx";
import {
  daysText,
  KEEP,
  type RetentionKey,
  retentionChange,
  retentionChoices,
  retentionDays,
  retentionNotice,
} from "./retention-model.ts";
import { failure } from "./shared-settings.tsx";

const choiceValue = (days: number | null) => (days === null ? KEEP : String(days));

function DaysChoice({
  label,
  days,
  choices,
  onChange,
}: {
  label: string;
  days: number | null;
  choices: (number | null)[];
  onChange: (days: number | null) => void;
}) {
  return (
    <Select
      value={choiceValue(days)}
      onValueChange={(next) => onChange(next === KEEP ? null : Number(next))}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-44">
        <SelectValue>{daysText(days)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choiceValue(choice)} value={choiceValue(choice)}>
            {daysText(choice)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const rows: { key: RetentionKey; label: string; help: string }[] = [
  {
    key: "deleted_after_days",
    label: "Remove deleted items after",
    help: "Deleted slides, annotations and results. Legal holds and review tasks keep them.",
  },
  {
    key: "audit_after_days",
    label: "Keep audit events for",
    help: "At least one year. The audit chain stays verifiable after a removal.",
  },
];

export function RetentionZone({ notify }: { notify: Notify }) {
  const policy = okData(useGetRetentionPolicy().data);
  const queryClient = useQueryClient();
  const update = useSetRetentionPolicy();
  if (policy === undefined) return null;
  const send = (change: RetentionPolicy, message: string, undo?: () => void) =>
    update.mutate(
      { data: change },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetRetentionPolicyQueryKey() });
          notify(message, undo);
        },
        onError: (error) => notify(failure(error)),
      },
    );
  const change = (key: RetentionKey, days: number | null) => {
    if (days === retentionDays(policy, key)) return;
    send(retentionChange(policy, key, days), retentionNotice(key, days), () =>
      send(policy, "Retention restored."),
    );
  };
  return (
    <Zone title="Retention" sub="Nothing is removed until you choose a period.">
      <div className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-x-4 gap-y-4 text-body-sm">
        {rows.map((row) => {
          const days = retentionDays(policy, row.key);
          return (
            <div key={row.key} className="contents">
              <span className="pt-1.5 text-fg-dim">{row.label}</span>
              <div className="grid justify-items-start gap-1.5">
                <DaysChoice
                  label={row.label}
                  days={days}
                  choices={retentionChoices(row.key, days)}
                  onChange={(next) => change(row.key, next)}
                />
                <small className="text-caption text-fg-dim">{row.help}</small>
              </div>
            </div>
          );
        })}
      </div>
    </Zone>
  );
}
