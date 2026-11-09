import {
  type AiModel,
  type Project,
  type SecuritySetting,
  useArchiveProject,
  useGetSecuritySettings,
  useGetSessionPolicy,
  useGetStorageUsage,
  useHideModel,
  useListAiModels,
  useListProjects,
  useListServiceAccounts,
  useListTaxonomyTemplates,
  useListWebhooks,
  useRestoreProject,
  useShowModel,
} from "@parfocal/api-client";
import { NameCell, SettingRow } from "@parfocal/ui/components/admin";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { AvatarStack, Person } from "@parfocal/ui/components/person";
import { ProgressBar } from "@parfocal/ui/components/progress-meter";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
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
import { useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { percent } from "../format.ts";
import { projectColour } from "../palette.ts";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import {
  InfoLine,
  lastActive,
  ModelStatus,
  MoreButton,
  type Notify,
  TextLink,
  tableClass,
} from "./common.tsx";
import {
  archiveActionLabel,
  archiveDoneNotice,
  archiveRefusalNotice,
  canChangeArchive,
  isArchived,
  type ProjectView,
  projectStatusLabel,
  projectsCountLabel,
} from "./projects-model.ts";
import { durationText } from "./workspace-settings-model.ts";

const right = "text-right";

export function ProjectsSection({ notify }: { notify: Notify }) {
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
  const usage = useGetStorageUsage().data?.data;
  const taxonomies = okData(useListTaxonomyTemplates().data) ?? [];
  const personOf = usePeople();
  const goTo = useGoTo();
  const [privacy, setPrivacy] = useState("deid");
  const [who, setWho] = useState("res");
  const spaceOf = (id: string) => usage?.by_project.find((row) => row.project.id === id);
  return (
    <>
      <Zone
        title="Projects"
        end={
          <span className="flex items-center gap-3">
            <SegmentedControl
              aria-label="Which projects to list"
              value={view}
              onValueChange={(value) => setView(value === "archived" ? "archived" : "active")}
              options={[
                { value: "active", label: "Active" },
                { value: "archived", label: "Archived" },
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
              <TableHead>Project</TableHead>
              <TableHead>Privacy</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Members</TableHead>
              <TableHead className={right}>Space</TableHead>
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
                      {project.privacy_mode === "clinical" ? "Clinical" : "De-identified"}
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
                        ? `${space.gb} of ${space.cap_gb} GB`
                        : `${space.gb} GB`
                      : ""}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center justify-end gap-1.5">
                      <Button size="sm" onClick={() => void goTo(destinations.project(project.id))}>
                        Open
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
      <Zone title="New projects">
        <div className="grid grid-cols-[180px_minmax(0,1fr)] items-start gap-x-4 gap-y-4 text-body-sm">
          <span className="pt-1 text-fg-dim">Privacy</span>
          <div className="grid gap-1.5">
            <SegmentedControl
              aria-label="Privacy of new projects"
              value={privacy}
              onValueChange={(value) => setPrivacy(String(value))}
              options={[
                { value: "deid", label: "De-identified" },
                { value: "clin", label: "Clinical" },
              ]}
            />
            <small className="text-caption text-fg-dim">
              Owners can switch a project later. Clinical projects log every slide opened.
            </small>
          </div>
          <span className="pt-1 text-fg-dim">Who can create one</span>
          <SegmentedControl
            aria-label="Who can create a project"
            value={who}
            onValueChange={(value) => setWho(String(value))}
            options={[
              { value: "res", label: "Every researcher" },
              { value: "adm", label: "Researchers with admin rights" },
            ]}
          />
          <span className="text-fg-dim">Class lists</span>
          <span className="flex items-center gap-2">
            {taxonomies
              .map((item) => (item.template === "pannuke" ? "PanNuke" : "Sentinel node"))
              .join(" · ")}
            <TextLink
              onClick={() => notify("Class lists: names, colors and the order they show in (mock)")}
            >
              Edit
            </TextLink>
          </span>
        </div>
      </Zone>
    </>
  );
}

const modelLists = (key: readonly unknown[]) =>
  typeof key[0] === "string" && key[0].endsWith("/models");

function useModelVisibility(notify: Notify) {
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
          notify(error instanceof Error ? error.message : "That did not save. Try again.");
        },
      },
    );
  };
  const change = (model: AiModel, next: boolean) => {
    apply(model, next);
    notify(
      next
        ? `${model.name} shows in every model list again.`
        : `${model.name} is hidden from every model list. Result sets it made stay.`,
      () => apply(model, !next),
    );
  };
  return { shownOf: (model: AiModel) => shown[model.id] ?? model.shown, change };
}

export function ModelsSection({ notify }: { notify: Notify }) {
  const data = useListAiModels().data?.data;
  const personOf = usePeople();
  const visibility = useModelVisibility(notify);
  const [cancelled, setCancelled] = useState<string[]>([]);
  if (data === undefined) return null;
  const parfocal = data.models.filter((model) => model.source === "parfocal");
  const lab = data.models.filter((model) => model.source === "lab");
  const running = data.running.filter((run) => !cancelled.includes(run.id));
  return (
    <>
      <Zone
        title="Parfocal models"
        sub="Always ready and kept up to date by Parfocal. They run on the Parfocal GPU in Prague, so slides stay in the EU. Hide one to take it out of every model list."
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Makes</TableHead>
              <TableHead>Who can run it</TableHead>
              <TableHead className={right}>Result sets</TableHead>
              <TableHead className={right}>Shown</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parfocal.map((model) => {
              const on = visibility.shownOf(model);
              return (
                <TableRow key={model.id} className={on ? "" : "opacity-55"}>
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
                      aria-label={`Show ${model.name}`}
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
        title="Your lab's models"
        sub="Models your lab runs on its own server. They show in every model list next to Parfocal's."
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Runs on</TableHead>
              <TableHead>Who can run it</TableHead>
              <TableHead className={right}>Result sets</TableHead>
              <TableHead>Status</TableHead>
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
                            `Sent one sample tile: answered in ${model.latency_ms ?? 0} ms, 38 cells (mock)`,
                          )
                        }
                      >
                        Test
                      </Button>
                    ) : null}
                    <MoreButton label={`More for ${model.name}`} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Zone>
      <Zone title="Running now">
        <div>
          {running.length === 0 ? (
            <span className="text-body-sm text-fg-dim">Nothing is running.</span>
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
                    sub={`${run.project.code} · ${run.slides} slides`}
                  />
                  {by ? <Person person={by} size={20} /> : <span />}
                  <ProgressBar
                    value={percent(run.slides_done, run.slides)}
                    label={`${run.slides_done} of ${run.slides} slides`}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCancelled([...cancelled, run.id]);
                      notify(
                        `${run.model} run cancelled. Slides already done keep their results.`,
                        () => setCancelled((current) => current.filter((id) => id !== run.id)),
                      );
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Zone>
      <InfoLine>
        A model that runs somewhere else can still bring its results in as files, like Lab model
        v3.0.
      </InfoLine>
    </>
  );
}

export function ApiSection({ notify }: { notify: Notify }) {
  const accounts = okData(useListServiceAccounts().data) ?? [];
  const hooks = useListWebhooks().data?.data ?? [];
  const [revoked, setRevoked] = useState<string[]>([]);
  return (
    <>
      <Zone
        title="Tokens"
        end={
          <Button
            size="sm"
            onClick={() =>
              notify("New token: pick a project and what it can do. Shown once (mock)")
            }
          >
            New token
          </Button>
        }
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead>Can</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.flatMap((account) =>
              account.tokens
                .filter((token) => !revoked.includes(token.id))
                .map((token) => (
                  <TableRow key={token.id}>
                    <TableCell className="font-mono font-semibold">
                      pf_live_…{token.id.slice(-4)}
                    </TableCell>
                    <TableCell>{account.name}</TableCell>
                    <TableCell>
                      {token.last_used_at ? lastActive(token.last_used_at) : "Never"}
                    </TableCell>
                    <TableCell>
                      <span className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRevoked([...revoked, token.id]);
                            notify("Token revoked. Pipelines using it stop at once (mock)");
                          }}
                        >
                          Revoke
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                )),
            )}
          </TableBody>
        </Table>
      </Zone>
      <Zone
        title="Webhooks"
        end={
          <Button
            size="sm"
            onClick={() =>
              notify("Add a webhook: incoming for a project, or outgoing to your server (mock)")
            }
          >
            Add webhook
          </Button>
        }
      >
        <Table className={tableClass}>
          <TableHeader>
            <TableRow>
              <TableHead>Webhook</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Events</TableHead>
              <TableHead className={right}>Today</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {hooks.map((hook) => (
              <TableRow key={hook.id}>
                <TableCell>
                  <b>{hook.name}</b>
                </TableCell>
                <TableCell>{hook.direction === "incoming" ? "Incoming" : "Outgoing"}</TableCell>
                <TableCell className="font-mono">{hook.events.join(", ")}</TableCell>
                <TableCell className={cn(right, "font-mono")}>{hook.calls_today}</TableCell>
                <TableCell>
                  {hook.rejected_today > 0 ? (
                    <StatusTag tone="warn">{hook.rejected_today} rejected</StatusTag>
                  ) : (
                    <StatusTag tone="ok">Answering</StatusTag>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex justify-end">
                    <MoreButton label={`More for ${hook.name}`} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Zone>
      <InfoLine>
        Pipelines post result files to a project's incoming webhook, signed with its token.
        <TextLink onClick={() => notify("Opens the API reference in the docs (mock)")}>
          API reference
        </TextLink>
      </InfoLine>
    </>
  );
}

const idleRow = (minutes: number): SecuritySetting => ({
  key: "idle-lock",
  label: "Lock after inactivity",
  detail: `${durationText(minutes)}. Slides and names hide until you sign in again`,
  on: true,
  locked: false,
});

export function SecuritySection({ notify }: { notify: Notify }) {
  const settings = useGetSecuritySettings().data?.data;
  const policy = okData(useGetSessionPolicy().data);
  const [values, setValues] = useState<Record<string, boolean>>({});
  if (settings === undefined && policy === undefined) return null;
  const sessionRows = [
    ...(policy ? [idleRow(policy.idle_lock_minutes)] : []),
    ...(settings?.data ?? []).filter((item) => item.key !== "idle-lock" || policy === undefined),
  ];
  const row = (item: SecuritySetting) => (
    <SettingRow
      key={item.key}
      label={item.label}
      detail={item.detail}
      on={values[item.key] ?? item.on}
      locked={item.locked}
      onChange={(on) => {
        setValues({ ...values, [item.key]: on });
        notify(
          item.key === "idle-lock"
            ? "Change the lock time in Workspace settings, under Lock times."
            : `${item.label} ${on ? "turned on" : "turned off"} (mock)`,
        );
      }}
    />
  );
  return (
    <div className="grid grid-cols-2 gap-(--space-zone)">
      {settings ? (
        <Zone title="Sign-in">
          <div>{settings.sign_in.map(row)}</div>
          <ProgressBar
            value={percent(settings.two_factor.people, settings.two_factor.of)}
            label="People with two factors"
            valueText={`${settings.two_factor.people} of ${settings.two_factor.of}`}
          />
        </Zone>
      ) : null}
      <Zone title="Sessions and data">
        <div>{sessionRows.map(row)}</div>
      </Zone>
    </div>
  );
}
