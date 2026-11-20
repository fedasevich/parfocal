import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type AiModel,
  type AiModelRun,
  getGetMySettingLayersQueryKey,
  type LabSettings,
  type Project,
  type SecuritySetting,
  useArchiveProject,
  useCancelModelRun,
  useGetMySettingLayers,
  useGetSecuritySettings,
  useGetStorageUsage,
  useHideModel,
  useListAiModels,
  useListProjects,
  useListTaxonomyTemplates,
  useRestoreProject,
  useSetWorkspaceSettings,
  useShowModel,
} from "@parfocal/api-client";

import { NameCell, SettingRow } from "@parfocal/ui/components/admin";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { AvatarStack, Person } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { SkeletonRows } from "@parfocal/ui/components/skeleton";
import { Switch } from "@parfocal/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { CategoryTag, StatusTag } from "@parfocal/ui/components/tag";
import { Zone } from "@parfocal/ui/components/zone";
import { cn } from "@parfocal/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { percent } from "../format.ts";
import { projectColour } from "../palette.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { InfoLine, ModelStatus, MoreButton, type Notify, tableClass } from "./common.tsx";
import { DeletedProjectsZone } from "./deleted-projects.tsx";
import {
  archiveActionLabel,
  archiveDoneNotice,
  archiveRefusalNotice,
  canChangeArchive,
  classListNames,
  isArchived,
  type ProjectView,
  projectStatusLabel,
  projectsCountLabel,
} from "./projects-model.ts";
import { signInRows, TWO_FACTOR_KEY, twoFactorChange } from "./security-model.ts";
import {
  ClassListChoice,
  IdleLockChoice,
  PrivacyChoice,
  useSessionPolicy,
} from "./shared-settings.tsx";

const right = "text-right";

export function ProjectsSection({ notify }: { notify: Notify }) {
  const { t } = useLingui();

  const [view, setView] = useState<ProjectView>("active");
  const projects = okData(useListProjects({ archived: view === "archived" }).data) ?? [];
  const queryClient = useQueryClient();
  const archive = useArchiveProject();
  const restore = useRestoreProject();
  const changeArchive = (project: Project) => {
    (isArchived(project) ? restore : archive).mutate(
      { projectId: project.id },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            predicate: (query) => String(query.queryKey[0]).startsWith("/api/projects"),
          });
          notify(archiveDoneNotice(project));
        },
        onError: () => notify(archiveRefusalNotice(project)),
      },
    );
  };
  const usage = okData(useGetStorageUsage().data);
  const taxonomies = okData(useListTaxonomyTemplates().data) ?? [];
  const lab = okData(useGetMySettingLayers().data)?.lab;
  const personOf = usePeople();
  const goTo = useGoTo();
  const spaceOf = (id: string) => usage?.by_project.find((row) => row.project.id === id);
  return (
    <>
      <Zone
        title={t`Projects`}
        end={
          <span className="flex items-center gap-3">
            <SegmentedControl
              aria-label={t`Which projects to list`}
              value={view}
              onValueChange={(value) => setView(value === "archived" ? "archived" : "active")}
              options={[
                { value: "active", label: t`Active` },
                { value: "archived", label: t`Archived` },
              ]}
            />
            <span className="text-body-sm text-fg-dim">
              {projectsCountLabel(projects.length, view)}
            </span>
          </span>
        }
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Project</Trans>
              </TableHead>
              <TableHead>
                <Trans>Privacy</Trans>
              </TableHead>
              <TableHead>
                <Trans>Status</Trans>
              </TableHead>
              <TableHead>
                <Trans>Owner</Trans>
              </TableHead>
              <TableHead>
                <Trans>Members</Trans>
              </TableHead>
              <TableHead className={right}>
                <Trans>Space</Trans>
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => {
              const owner = project.members.find((member) => member.role === "owner");
              const ownerPerson = personOf(owner?.user_id);
              const space = spaceOf(project.id);
              return (
                <TableRow key={project.id}>
                  <TableCell>
                    <NameCell
                      lead={
                        <i
                          aria-hidden="true"
                          className="block size-3 rounded-[3px]"
                          style={{ background: projectColour(project.colour) }}
                        />
                      }
                      title={project.name}
                      sub={<span className="font-mono">{project.code}</span>}
                    />
                  </TableCell>
                  <TableCell>
                    <StatusTag tone={project.privacy_mode === "clinical" ? "warn" : "accent"}>
                      {project.privacy_mode === "clinical" ? t`Clinical` : t`De-identified`}
                    </StatusTag>
                  </TableCell>
                  <TableCell>
                    <StatusTag tone={isArchived(project) ? "neutral" : "ok"}>
                      {projectStatusLabel(project)}
                    </StatusTag>
                  </TableCell>
                  <TableCell>
                    {ownerPerson ? <Person person={ownerPerson} size={20} /> : null}
                  </TableCell>
                  <TableCell>
                    <AvatarStack
                      size={22}
                      people={project.members.flatMap((member) => {
                        const person = personOf(member.user_id);
                        return person ? [person] : [];
                      })}
                    />
                  </TableCell>
                  <TableCell className={cn(right, "font-mono")}>
                    {space
                      ? space.cap_gb
                        ? t`${space.gb} of ${space.cap_gb} GB`
                        : t`${space.gb} GB`
                      : ""}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center justify-end gap-1.5">
                      <Button size="sm" onClick={() => void goTo(destinations.project(project.id))}>
                        <Trans>Open</Trans>
                      </Button>
                      <Button
                        size="sm"
                        aria-label={`${archiveActionLabel(project)} ${project.name}`}
                        disabled={
                          !canChangeArchive(project) || archive.isPending || restore.isPending
                        }
                        onClick={() => changeArchive(project)}
                      >
                        {archiveActionLabel(project)}
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Zone>
      <DeletedProjectsZone notify={notify} />
      <Zone title={t`New projects`}>
        <div className="grid grid-cols-[180px_minmax(0,1fr)] items-start gap-x-4 gap-y-4 text-body-sm">
          <span className="pt-1 text-fg-dim">
            <Trans>Privacy</Trans>
          </span>
          <div className="grid justify-items-start gap-1.5">
            {lab ? (
              <PrivacyChoice lab={lab} notify={notify} label={t`Privacy of new projects`} />
            ) : null}
            <small className="text-caption text-fg-dim">
              <Trans>
                Owners can switch a project later. Clinical projects need a security contact.
              </Trans>
            </small>
          </div>
          <span className="text-fg-dim">
            <Trans>Class lists</Trans>
          </span>
          <div className="grid justify-items-start gap-1.5">
            {lab ? (
              <ClassListChoice lab={lab} notify={notify} label={t`Class list of new projects`} />
            ) : null}
            <small className="text-caption text-fg-dim">
              <Trans>
                Built-in lists: {classListNames(taxonomies)}. Each project can change its own
                classes.
              </Trans>
            </small>
          </div>
        </div>
      </Zone>
    </>
  );
}

const modelLists = (key: readonly unknown[]) =>
  typeof key[0] === "string" && key[0].endsWith("/models");

function useModelVisibility(notify: Notify) {
  const { t } = useLingui();

  const queryClient = useQueryClient();
  const hide = useHideModel();
  const show = useShowModel();
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const apply = (model: AiModel, next: boolean) => {
    setShown((current) => ({ ...current, [model.id]: next }));
    if (model.catalogue_name === null) return;
    (next ? show : hide).mutate(
      { name: model.catalogue_name },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({ predicate: (query) => modelLists(query.queryKey) }),
        onError: (error) => {
          setShown((current) => ({ ...current, [model.id]: !next }));
          notify(error instanceof Error ? error.message : t`That did not save. Try again.`);
        },
      },
    );
  };
  const change = (model: AiModel, next: boolean) => {
    apply(model, next);
    notify(
      next
        ? t`${model.name} shows in every model list again.`
        : t`${model.name} is hidden from every model list. Result sets it made stay.`,
      () => apply(model, !next),
    );
  };
  return { shownOf: (model: AiModel) => shown[model.id] ?? model.shown, change };
}

const cancelDelayMs = 6000;

function useRunCancellation(notify: Notify) {
  const { t } = useLingui();

  const queryClient = useQueryClient();
  const cancel = useCancelModelRun();
  const [cancelled, setCancelled] = useState<string[]>([]);
  const pending = useRef(new Map<string, { run: AiModelRun; timer: number }>());
  const commit = (run: AiModelRun) => {
    pending.current.delete(run.id);
    cancel.mutate(
      { projectId: run.project.id, runId: run.id },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({ predicate: (query) => modelLists(query.queryKey) }),
        onError: (error) => {
          setCancelled((current) => current.filter((id) => id !== run.id));
          notify(error instanceof Error ? error.message : t`That did not cancel. Try again.`);
        },
      },
    );
  };
  const flush = useRef(commit);
  flush.current = commit;
  useEffect(
    () => () => {
      for (const { run, timer } of pending.current.values()) {
        window.clearTimeout(timer);
        flush.current(run);
      }
    },
    [],
  );
  const start = (run: AiModelRun) => {
    setCancelled((current) => [...current, run.id]);
    const timer = window.setTimeout(() => commit(run), cancelDelayMs);
    pending.current.set(run.id, { run, timer });
    notify(t`${run.model} run cancelled. Slides already done keep their results.`, () => {
      window.clearTimeout(timer);
      pending.current.delete(run.id);
      setCancelled((current) => current.filter((id) => id !== run.id));
    });
  };
  return { cancelled, start };
}

export function ModelsSection({ notify }: { notify: Notify }) {
  const { t } = useLingui();

  const data = okData(useListAiModels().data);
  const personOf = usePeople();
  const visibility = useModelVisibility(notify);
  const { cancelled, start } = useRunCancellation(notify);
  if (data === undefined) return <SkeletonRows label={t`Loading models`} rows={4} columns={4} />;
  const parfocal = data.models.filter((model) => model.source === "parfocal");
  const lab = data.models.filter((model) => model.source === "lab");
  const running = data.running.filter((run) => !cancelled.includes(run.id));
  return (
    <>
      <Zone
        title={t`Parfocal models`}
        sub={t`Always ready and kept up to date by Parfocal. They run on the Parfocal GPU in Prague, so slides stay in the EU. Hide one to take it out of every model list.`}
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Model</Trans>
              </TableHead>
              <TableHead>
                <Trans>Makes</Trans>
              </TableHead>
              <TableHead>
                <Trans>Who can run it</Trans>
              </TableHead>
              <TableHead className={right}>
                <Trans>Result sets</Trans>
              </TableHead>
              <TableHead className={right}>
                <Trans>Shown</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parfocal.map((model) => {
              const on = visibility.shownOf(model);
              return (
                <TableRow
                  key={model.id}
                  className={on ? "" : "[&>td]:text-fg-faint [&_b]:text-fg-faint"}
                >
                  <TableCell>
                    <NameCell
                      lead={<Icon name="smart" />}
                      title={model.name}
                      version={model.version}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="flex gap-1.5">
                      {model.makes.map((item) => (
                        <CategoryTag key={item}>{item}</CategoryTag>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>{model.who_can_run}</TableCell>
                  <TableCell className={cn(right, "font-mono")}>{model.result_sets}</TableCell>
                  <TableCell className={right}>
                    <Switch
                      aria-label={t`Show ${model.name}`}
                      checked={on}
                      onCheckedChange={(next) => visibility.change(model, next)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Zone>
      <Zone
        title={t`Your lab's models`}
        sub={t`Models your lab runs on its own server. They show in every model list next to Parfocal's.`}
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Model</Trans>
              </TableHead>
              <TableHead>
                <Trans>Runs on</Trans>
              </TableHead>
              <TableHead>
                <Trans>Who can run it</Trans>
              </TableHead>
              <TableHead className={right}>
                <Trans>Result sets</Trans>
              </TableHead>
              <TableHead>
                <Trans>Status</Trans>
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lab.map((model) => (
              <TableRow key={model.id}>
                <TableCell>
                  <NameCell
                    lead={<Icon name="smart" />}
                    title={model.name}
                    version={model.version}
                    sub={model.description}
                  />
                </TableCell>
                <TableCell>{model.runs_on}</TableCell>
                <TableCell>{model.who_can_run}</TableCell>
                <TableCell className={cn(right, "font-mono")}>{model.result_sets}</TableCell>
                <TableCell>
                  <ModelStatus model={model} />
                </TableCell>
                <TableCell>
                  <span className="flex items-center justify-end gap-1.5">
                    {model.status === "answering" ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          notify(
                            t`Sent one sample tile: answered in ${model.latency_ms ?? 0} ms, 38 cells (mock)`,
                          )
                        }
                      >
                        <Trans>Test</Trans>
                      </Button>
                    ) : null}
                    <MoreButton label={t`More for ${model.name}`} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Zone>
      <Zone title={t`Running now`}>
        <div>
          {running.length === 0 ? (
            <span className="text-body-sm text-fg-dim">
              <Trans>Nothing is running.</Trans>
            </span>
          ) : (
            running.map((run) => {
              const by = personOf(run.started_by);
              return (
                <div
                  key={run.id}
                  className="grid min-h-10 grid-cols-[minmax(0,1fr)_150px_220px_auto] items-center gap-4.5 border-t border-line py-1.75 text-body-sm first:border-t-0"
                >
                  <NameCell
                    lead={<Icon name="smart" />}
                    title={run.model}
                    sub={t`${run.project.code} · ${plural(run.slides, { one: "# slide", other: "# slides" })}`}
                  />
                  {by ? <Person person={by} size={20} /> : <span />}
                  <ProgressBar
                    value={percent(run.slides_done, run.slides)}
                    label={t`${run.slides_done} of ${plural(run.slides, { one: "# slide", other: "# slides" })}`}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t`Cancel ${run.model} run`}
                    onClick={() => start(run)}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Zone>
      <InfoLine>
        <Trans>
          A model that runs somewhere else can still bring its results in as files, like Lab model
          v3.0.
        </Trans>
      </InfoLine>
    </>
  );
}

function IdleLockRow({ notify }: { notify: Notify }) {
  const { policy, save } = useSessionPolicy(notify);
  if (policy === undefined) return null;
  return (
    <div
      data-slot="setting-row"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-(--density-list-row-y) text-body-sm first:pt-0.5 [&+&]:border-t [&+&]:border-line"
    >
      <span>
        <b className="block font-semibold text-fg">
          <Trans>Lock after inactivity</Trans>
        </b>
        <small className="mt-0.5 block text-body-sm leading-[1.45] text-fg-dim">
          <Trans>Slides and names hide until people sign in again</Trans>
        </small>
      </span>
      <IdleLockChoice minutes={policy.idle_lock_minutes} save={save} />
    </div>
  );
}

export function SecuritySection({ notify }: { notify: Notify }) {
  const { t } = useLingui();

  const queryClient = useQueryClient();
  const settings = okData(useGetSecuritySettings().data);
  const lab = okData(useGetMySettingLayers().data)?.lab;
  const save = useSetWorkspaceSettings();
  if (settings === undefined && lab === undefined) return null;
  const saveTwoFactor = (current: LabSettings, on: boolean) =>
    save.mutate(
      { data: twoFactorChange(current, on) },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetMySettingLayersQueryKey() });
          notify(
            on
              ? t`Saved. Members without a second factor are asked to set one up and sign in again.`
              : t`Saved. Two factors are no longer required for everyone.`,
          );
        },
        onError: () => notify(t`The two factor setting did not save. Try again.`),
      },
    );
  const row = (item: SecuritySetting) => (
    <SettingRow
      key={item.key}
      label={item.label}
      detail={item.detail}
      on={item.on}
      locked={item.locked}
      onChange={(on) => {
        if (item.key === TWO_FACTOR_KEY && lab) saveTwoFactor(lab, on);
      }}
    />
  );
  return (
    <div className="grid grid-cols-2 gap-(--space-zone)">
      <Zone title={t`Sign-in`}>
        <div>{signInRows(settings?.sign_in, lab).map(row)}</div>
        {settings?.two_factor ? (
          <ProgressBar
            value={percent(settings.two_factor.people, settings.two_factor.of)}
            label={t`People with two factors`}
            valueText={t`${settings.two_factor.people} of ${settings.two_factor.of}`}
          />
        ) : null}
      </Zone>
      <Zone title={t`Sessions and data`}>
        <div>
          <IdleLockRow notify={notify} />
        </div>
      </Zone>
    </div>
  );
}
