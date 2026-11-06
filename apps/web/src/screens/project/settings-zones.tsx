import {
  getGetProjectQueryKey,
  type Project,
  type SignOutRight,
  useSetProjectMemberSignOut,
  useUpdateProject,
} from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { NumberStepper } from "@parfocal/ui/components/number-stepper";
import { Person } from "@parfocal/ui/components/person";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Zone } from "@parfocal/ui/components/zone";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { usePeople } from "./people.ts";
import {
  clinicalTemplateOptions,
  matchLimits,
  nobodySignsOut,
  nobodySignsOutWarning,
  roleText,
  signOutOptions,
  signOutRows,
  viewersCannotSignOut,
  withRight,
} from "./settings-model.ts";

type Toast = (message: ReactNode, onUndo?: () => void) => void;

type Defaults = Partial<
  Pick<
    Project,
    | "blinded"
    | "ai_hidden_first_read"
    | "study_template_id"
    | "clinical_template"
    | "match_iou"
    | "match_distance_um"
  >
>;

export function useProjectChange(project: Project, toast: Toast) {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<Defaults>({});
  const { mutate } = useUpdateProject();
  const change = (next: Defaults) => {
    const before = shown;
    setShown({ ...shown, ...next });
    mutate(
      { projectId: project.id, data: next },
      {
        onSuccess: (response) => {
          if (response.status !== 200) {
            setShown(before);
            toast("Only an owner of this project changes its settings.");
            return;
          }
          queryClient.setQueryData(getGetProjectQueryKey(project.id), response);
        },
        onError: () => {
          setShown(before);
          toast("The setting was not saved. Try again.");
        },
      },
    );
  };
  return { value: { ...project, ...shown }, change };
}

export function ReportTemplateZone({
  value,
  onChange,
}: {
  value: Project["clinical_template"];
  onChange: (change: Defaults) => void;
}) {
  return (
    <Zone title="Report template" sub="Lays out the clinical report of each case.">
      <RadioGroup
        aria-label="Report template"
        value={value ?? "sentinel-node"}
        onValueChange={(next) =>
          onChange({ clinical_template: next as NonNullable<Project["clinical_template"]> })
        }
      >
        {clinicalTemplateOptions.map((item) => (
          <label
            key={item.value}
            className="flex cursor-pointer items-center gap-2.5 py-1 text-body-sm text-fg"
          >
            <RadioGroupItem value={item.value} />
            <span>
              {item.name}
              <small className="ml-2 text-caption text-fg-faint">{item.detail}</small>
            </span>
          </label>
        ))}
      </RadioGroup>
    </Zone>
  );
}

export function IdMatchingZone({
  iou,
  distance,
  onChange,
}: {
  iou: number;
  distance: number;
  onChange: (change: Defaults) => void;
}) {
  return (
    <Zone title="ID matching" sub="A new result set keeps the IDs of the objects it overlaps.">
      <div className="grid gap-2 text-body-sm text-fg" data-testid="id-matching">
        <div className="flex items-center justify-between gap-4">
          <span>Regions match at an overlap (IoU) of at least</span>
          <NumberStepper
            label="Region overlap"
            value={iou}
            {...matchLimits.iou}
            onValueChange={(next) => next !== null && onChange({ match_iou: next })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Cells match when their centres are at most this many µm apart</span>
          <NumberStepper
            label="Cell distance"
            value={distance}
            {...matchLimits.distance}
            onValueChange={(next) => next !== null && onChange({ match_distance_um: next })}
          />
        </div>
      </div>
    </Zone>
  );
}

export function ClinicalMembersZone({ project, toast }: { project: Project; toast: Toast }) {
  const people = usePeople();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(() => signOutRows(project.members));
  const { mutate } = useSetProjectMemberSignOut();
  const owner = project.members.find((member) => member.role === "owner");
  const set = (userId: string, right: SignOutRight) => {
    const before = rows;
    setRows(withRight(rows, userId, right));
    mutate(
      { projectId: project.id, userId, data: { sign_out: right } },
      {
        onSuccess: (response) => {
          if (response.status !== 200) {
            setRows(before);
            toast("Only an owner of this project sets who can sign out.");
            return;
          }
          queryClient.setQueryData(getGetProjectQueryKey(project.id), {
            ...response,
            data: response.data.project,
          });
        },
        onError: () => setRows(before),
      },
    );
  };
  return (
    <Zone
      title="Members"
      sub={`Own cases means the cases a member is assigned to. A member who cannot sign out sends the report for co-sign to one who can.${owner ? ` Set by ${people.byId(owner.user_id).name}, the owner.` : ""}`}
      end={
        <Link to="/admin" className="text-body-sm font-medium text-accent hover:underline">
          Invite people
        </Link>
      }
    >
      <div className="grid gap-2.5" data-testid="sign-out-rights">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] text-caption font-semibold text-fg-dim">
          <span>Member</span>
          <span>Can sign out</span>
        </div>
        {rows.map((row) => {
          const person = people.byId(row.userId);
          return (
            <div
              key={row.userId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
              data-testid="sign-out-row"
            >
              <Person person={person} size={28} sub={roleText[row.role]} />
              {row.fixed ? (
                <span
                  className="px-3 text-caption font-medium text-fg-faint"
                  title={viewersCannotSignOut}
                >
                  Never
                </span>
              ) : (
                <SegmentedControl
                  aria-label={`Can sign out, ${person.name}`}
                  value={row.right}
                  options={signOutOptions}
                  onValueChange={(next) => set(row.userId, next as SignOutRight)}
                />
              )}
            </div>
          );
        })}
        {nobodySignsOut(rows) ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-ctl border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,var(--chrome))] px-3 py-2 text-body-sm text-fg"
          >
            <Icon name="warn" className="mt-0.5 text-warn" />
            <span>{nobodySignsOutWarning}</span>
          </div>
        ) : null}
      </div>
    </Zone>
  );
}
