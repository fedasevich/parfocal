import {
  type Announcement,
  type AnnouncementKind,
  getGetMySettingLayersQueryKey,
  getGetSessionPolicyQueryKey,
  getListAnnouncementsQueryKey,
  getListModelTiersQueryKey,
  type LabSettings,
  type ModelTier,
  type SessionPolicy,
  type TierTask,
  useCreateAnnouncement,
  useEndAnnouncement,
  useGetMySettingLayers,
  useGetSessionPolicy,
  useListAnnouncements,
  useListModelTiers,
  useListStudyTemplates,
  useResetModelTier,
  useSetModelTier,
  useSetWorkspaceSettings,
  useUpdateSessionPolicy,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Input } from "@parfocal/ui/components/input";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { CategoryTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { now } from "../../clock.ts";
import { okData } from "../placeholder.tsx";
import { type Notify, tableClass } from "./common.tsx";
import {
  type AnnouncementEnd,
  announcementEnds,
  announcementKinds,
  classOptions,
  type DefaultKey,
  defaultChange,
  defaultsOf,
  durationText,
  emergencyHourChoices,
  endsAtFor,
  idleLockChoices,
  isAnnouncementText,
  modelsForTask,
  NO_TEMPLATE,
  NOT_CHOSEN,
  privacyOptions,
  sessionHourChoices,
  taskText,
  tierCell,
  tierLevels,
  tierTasks,
  tierText,
  withCurrent,
} from "./workspace-settings-model.ts";

const rows = "grid grid-cols-[200px_minmax(0,1fr)] items-start gap-x-4 gap-y-4 text-body-sm";

const defaultEmergencyHours = 4;

const emptyLab: LabSettings = { values: {}, locked: [] };

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "That did not save. Try again.";

function Labelled({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="pt-1.5 text-fg-dim">{label}</span>
      <div className="grid justify-items-start gap-1.5">
        {children}
        {help ? <small className="text-caption text-fg-dim">{help}</small> : null}
      </div>
    </>
  );
}

function NumberChoice({
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

function LockTimes({ notify }: { notify: Notify }) {
  const policy = okData(useGetSessionPolicy().data);
  const queryClient = useQueryClient();
  const update = useUpdateSessionPolicy();
  if (policy === undefined) return null;
  const save = (next: Partial<SessionPolicy>, said: string) => {
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
  const hoursText = (hours: number) => (hours === 1 ? "1 hour" : `${hours} hours`);
  return (
    <Zone
      title="Lock times"
      sub="When a screen locks, how long a sign-in lasts and how long emergency access lasts."
    >
      <div className={rows}>
        <Labelled
          label="Lock after inactivity"
          help="People unlock with their password or passkey."
        >
          <NumberChoice
            label="Lock after inactivity"
            value={policy.idle_lock_minutes}
            choices={idleLockChoices}
            format={durationText}
            onChange={(value) =>
              save(
                { idle_lock_minutes: value },
                `Screens lock after ${durationText(value)} without activity.`,
              )
            }
          />
        </Labelled>
        <Labelled label="Sign-in lasts" help="After this long people sign in again.">
          <NumberChoice
            label="Sign-in lasts"
            value={policy.session_hours}
            choices={sessionHourChoices}
            format={hoursText}
            onChange={(value) =>
              save({ session_hours: value }, `Sign-ins last ${hoursText(value)} now.`)
            }
          />
        </Labelled>
        <Labelled label="Emergency access lasts">
          <NumberChoice
            label="Emergency access lasts"
            value={policy.emergency_hours ?? defaultEmergencyHours}
            choices={emergencyHourChoices}
            format={hoursText}
            onChange={(value) =>
              save({ emergency_hours: value }, `Emergency access lasts ${hoursText(value)} now.`)
            }
          />
        </Labelled>
      </div>
    </Zone>
  );
}

function Defaults({ lab, notify }: { lab: LabSettings; notify: Notify }) {
  const templates = (okData(useListStudyTemplates().data) ?? []).filter(
    (template) => template.retired_at === null,
  );
  const queryClient = useQueryClient();
  const save = useSetWorkspaceSettings();
  const current = defaultsOf(lab);
  const apply = (key: DefaultKey, value: string | null, said: string, undo?: () => void) =>
    save.mutate(
      { data: defaultChange(lab, key, value) },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() });
          notify(said, undo);
        },
        onError: (error) => notify(failure(error)),
      },
    );
  const change = (key: DefaultKey, was: string, value: string, said: string) =>
    apply(key, value, said, () => apply(key, was, "Default restored."));
  const templateName =
    templates.find((template) => template.id === current.template)?.name ?? "No template";
  return (
    <Zone
      title="Defaults for new work"
      sub="What a new project and a new review task start with. People can change them there."
    >
      <div className={rows}>
        <Labelled
          label="Privacy of new projects"
          help="Owners can switch a project later. Clinical projects log every slide opened."
        >
          <SegmentedControl
            aria-label="Privacy of new projects"
            value={current.privacy}
            onValueChange={(value) => {
              const next = String(value);
              if (next === current.privacy) return;
              change(
                "default_privacy_mode",
                current.privacy,
                next,
                `New projects start ${next === "clinical" ? "clinical" : "de-identified"}.`,
              );
            }}
            options={privacyOptions.map((option) => ({ ...option }))}
          />
        </Labelled>
        <Labelled label="Classes of new projects">
          <Select
            value={current.classes}
            onValueChange={(value) =>
              change(
                "default_classes",
                current.classes,
                String(value),
                "New projects start with that class list.",
              )
            }
          >
            <SelectTrigger size="sm" aria-label="Classes of new projects" className="w-48">
              <SelectValue>
                {classOptions.find((option) => option.value === current.classes)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {classOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labelled>
        <Labelled label="Study template of new tasks">
          <Select
            value={current.template === NO_TEMPLATE ? NOT_CHOSEN : current.template}
            onValueChange={(value) =>
              change(
                "default_study_template",
                current.template,
                value === NOT_CHOSEN ? NO_TEMPLATE : String(value),
                "New review tasks start from that template.",
              )
            }
          >
            <SelectTrigger size="sm" aria-label="Study template of new tasks" className="w-64">
              <SelectValue>{templateName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOT_CHOSEN}>No template</SelectItem>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labelled>
      </div>
    </Zone>
  );
}

function Tiers({ notify }: { notify: Notify }) {
  const mappings = okData(useListModelTiers().data) ?? [];
  const queryClient = useQueryClient();
  const set = useSetModelTier();
  const reset = useResetModelTier();
  const refreshed = () => queryClient.invalidateQueries({ queryKey: getListModelTiersQueryKey() });
  const choose = (task: TierTask, tier: ModelTier, value: string) => {
    const title = `${taskText[task]}, ${tierText[tier]}`;
    if (value === NOT_CHOSEN) {
      reset.mutate(
        { task, tier },
        {
          onSuccess: () => {
            void refreshed();
            notify(`${title} is back to Parfocal's choice.`);
          },
          onError: (error) => notify(failure(error)),
        },
      );
      return;
    }
    set.mutate(
      { task, tier, data: { name: value } },
      {
        onSuccess: () => {
          void refreshed();
          notify(`${title} uses your choice now.`);
        },
        onError: (error) => notify(failure(error)),
      },
    );
  };
  return (
    <Zone
      title="Model tiers"
      sub="The model behind Best, Good and Fast when someone asks for an outline, tumor regions or cell types."
    >
      <Table className={tableClass}>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            {tierLevels.map((tier) => (
              <TableHead key={tier}>{tierText[tier]}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tierTasks.map((task) => (
            <TableRow key={task}>
              <TableCell>{taskText[task]}</TableCell>
              {tierLevels.map((tier) => {
                const cell = tierCell(mappings, task, tier);
                return (
                  <TableCell key={tier}>
                    <Select
                      value={cell.value}
                      onValueChange={(value) => choose(task, tier, String(value))}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`${taskText[task]}, ${tierText[tier]}`}
                        className="w-56"
                      >
                        <SelectValue>{cell.shown}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NOT_CHOSEN}>Parfocal's choice</SelectItem>
                        {modelsForTask(task).map((model) => (
                          <SelectItem key={model.name} value={model.name}>
                            {model.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Zone>
  );
}

function Announcements({ notify }: { notify: Notify }) {
  const current: Announcement[] = okData(useListAnnouncements().data) ?? [];
  const queryClient = useQueryClient();
  const create = useCreateAnnouncement();
  const end = useEndAnnouncement();
  const [kind, setKind] = useState<AnnouncementKind>("change");
  const [text, setText] = useState("");
  const [ends, setEnds] = useState<AnnouncementEnd>("never");
  const refreshed = () =>
    queryClient.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() });
  const post = () =>
    create.mutate(
      { data: { kind, text: text.trim(), ends_at: endsAtFor(ends, now()) } },
      {
        onSuccess: () => {
          void refreshed();
          setText("");
          notify("Announcement posted. Everyone sees it on Home.");
        },
        onError: (error) => notify(failure(error)),
      },
    );
  const stop = (item: Announcement) =>
    end.mutate(
      { announcementId: item.id },
      {
        onSuccess: () => {
          void refreshed();
          notify("Announcement ended.");
        },
        onError: (error) => notify(failure(error)),
      },
    );
  return (
    <Zone
      title="Announcements"
      sub="A short note everyone in the workspace sees on Home until it ends."
    >
      <div className="grid gap-3">
        {current.length === 0 ? (
          <span className="text-body-sm text-fg-dim">No announcements are showing.</span>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {current.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 text-body-sm text-fg"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CategoryTag>
                    {announcementKinds.find((option) => option.value === item.kind)?.label}
                  </CategoryTag>
                  <span className="min-w-0 truncate">{item.text}</span>
                </span>
                <Button size="sm" aria-label={`End: ${item.text}`} onClick={() => stop(item)}>
                  End
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (isAnnouncementText(text)) post();
          }}
        >
          <Select value={kind} onValueChange={(value) => setKind(value as AnnouncementKind)}>
            <SelectTrigger size="sm" aria-label="Kind of announcement" className="w-36">
              <SelectValue>
                {announcementKinds.find((option) => option.value === kind)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {announcementKinds.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Announcement text"
            placeholder="What should everyone know?"
            maxLength={280}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-w-64 flex-1"
          />
          <Select value={ends} onValueChange={(value) => setEnds(value as AnnouncementEnd)}>
            <SelectTrigger size="sm" aria-label="Announcement ends" className="w-40">
              <SelectValue>
                {announcementEnds.find((option) => option.value === ends)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {announcementEnds.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="primary" disabled={!isAnnouncementText(text)}>
            Post
          </Button>
        </form>
      </div>
    </Zone>
  );
}

export function WorkspaceSettingsSection({ notify }: { notify: Notify }) {
  const lab = okData(useGetMySettingLayers().data)?.lab ?? emptyLab;
  return (
    <>
      <LockTimes notify={notify} />
      <Defaults lab={lab} notify={notify} />
      <Tiers notify={notify} />
      <Announcements notify={notify} />
    </>
  );
}
