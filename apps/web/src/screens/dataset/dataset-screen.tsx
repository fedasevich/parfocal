import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type DatasetOrigin,
  type DatasetSummary,
  type DatasetVersion,
  type FinalLayerStatus,
  getGetTaskDatasetQueryKey,
  getListDatasetVersionsQueryKey,
  type ProjectClass,
  useBuildFinalLayer,
  useFreezeDatasetVersion,
  useGetProject,
  useGetReviewTask,
  useGetReviewTaskStates,
  useGetTaskDataset,
  useListDatasetVersions,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Breadcrumbs } from "@parfocal/ui/components/flow-page";
import { Loader } from "@parfocal/ui/components/loader";
import { Textarea } from "@parfocal/ui/components/textarea";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { downloadDatasetVersion, refusalText } from "../../annotations/task-export.ts";
import { destinations } from "../../shell/destinations.ts";
import { usePageTitleDetail } from "../../shell/page-title.ts";
import { useRouterLink } from "../../shell/router-link.tsx";
import { okData } from "../placeholder.tsx";
import { useScreenToast } from "../project/screen-toast.tsx";
import {
  type CheckedOrigin,
  checkedOrigins,
  className,
  datasetParams,
  drawnOrigins,
  freezeFilters,
  narrowed,
  type PageFilters,
  shortChecksum,
  sizeText,
  startingFilters,
  toggled,
  totalOf,
} from "./dataset-filters.ts";

const PatchExportDialog = lazy(async () => ({
  default: (await import("../../viewer/patch-export-dialog.tsx")).PatchExportDialog,
}));

function problemCode(error: unknown): string | null {
  const code = (error as { problem?: { code?: string } } | null)?.problem?.code;
  return typeof code === "string" ? code : null;
}

function whenText(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function objectsLine(objects: number, slides: number): string {
  const counted = plural(objects, { one: "# object", other: "# objects" });
  return plural(slides, {
    one: `${counted} on # slide`,
    other: `${counted} on # slides`,
  });
}

function useOriginNames(): Record<DatasetOrigin, string> {
  const { t } = useLingui();
  return {
    human: t`Added by a person`,
    "ai-confirmed": t`AI, agreed`,
    "ai-edited": t`AI, edited`,
    "ai-unchecked": t`AI, not checked`,
    "drawn-confirmed": t`Drawn, agreed`,
    "drawn-edited": t`Drawn, edited`,
  };
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="grid content-start gap-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="m-0 text-body font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Choice({
  testId,
  label,
  checked,
  disabled = false,
  onChange,
}: {
  testId: string;
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-body-sm text-fg" data-testid={testId}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => onChange()} />
      <span>{label}</span>
    </label>
  );
}

function CountRows({ rows }: { rows: { key: string; label: string; count: number }[] }) {
  return (
    <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body-sm">
      {rows.map((row) => (
        <div key={row.key} className="contents" data-testid={`dataset-count-${row.key}`}>
          <dt className="text-fg-dim">{row.label}</dt>
          <dd className="m-0 text-right font-medium text-fg tabular-nums">{row.count}</dd>
        </div>
      ))}
    </dl>
  );
}

function FinalLayer({
  status,
  building,
  onBuild,
}: {
  status: FinalLayerStatus | null | undefined;
  building: boolean;
  onBuild: () => void;
}) {
  const counts = status?.counts;
  const when = status ? whenText(status.built_at) : "";
  return (
    <Section title={<Trans>Final layer</Trans>}>
      <p className="m-0 text-body-sm text-fg-dim">
        <Trans>
          Signing off the task turns its decisions and edits into one final layer. Agreed objects go
          in as agreed, redrawn or retyped ones as edited with who edited them, the adjudicator's
          outcome wins, rejected objects are deleted and added ones go in as added by a person.
        </Trans>
      </p>
      {status && counts ? (
        <p className="m-0 text-body-sm text-fg" data-testid="final-layer-status">
          <Trans>
            Build {status.build} on {when}: {counts.confirmed ?? 0} agreed, {counts.edited ?? 0}{" "}
            edited, {counts.rejected ?? 0} rejected, {counts.added ?? 0} added, {counts.unsure ?? 0}{" "}
            unsure and {counts.open ?? 0} open left out.
          </Trans>
        </p>
      ) : (
        <p className="m-0 text-body-sm text-fg-dim" data-testid="final-layer-status">
          <Trans>No final layer is built yet.</Trans>
        </p>
      )}
      <div>
        <Button data-testid="final-layer-build" disabled={building} onClick={onBuild}>
          {status ? (
            <Trans>Build the final layer again</Trans>
          ) : (
            <Trans>Build the final layer</Trans>
          )}
        </Button>
      </div>
    </Section>
  );
}

function Counts({ summary, classes }: { summary: DatasetSummary; classes: ProjectClass[] }) {
  const { t } = useLingui();
  const names = useOriginNames();
  const total = totalOf(summary.objects);
  const originRows = (Object.keys(names) as DatasetOrigin[])
    .filter((origin) => origin !== "ai-unchecked" || summary.filters.include_unchecked)
    .filter((origin) => !drawnOrigins.has(origin) || (summary.objects[origin] ?? 0) > 0)
    .map((origin) => ({ key: origin, label: names[origin], count: summary.objects[origin] ?? 0 }));
  const classRows = Object.entries(summary.classes).map(([key, count]) => ({
    key: `class-${key}`,
    label: className(key, classes, t`No class`),
    count,
  }));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title={<Trans>By origin</Trans>}>
        <p className="m-0 text-body-sm text-fg" data-testid="dataset-total">
          {objectsLine(total, summary.slides.length)}
        </p>
        <CountRows rows={originRows} />
        <p className="m-0 text-caption text-fg-dim" data-testid="dataset-left-out">
          {summary.final_layer ? (
            <Trans>
              Left out: {summary.unsure_left_out ?? 0} unsure, {summary.open_left_out ?? 0} open,{" "}
              {summary.unchecked_left_out} not checked, {summary.filtered_out} by the filters
            </Trans>
          ) : (
            <Trans>
              Left out: {summary.unchecked_left_out} not checked, {summary.filtered_out} by the
              filters
            </Trans>
          )}
        </p>
      </Section>
      <Section title={<Trans>By class</Trans>}>
        {classRows.length === 0 ? (
          <p className="m-0 text-body-sm text-fg-dim">
            <Trans>No object matches these filters.</Trans>
          </p>
        ) : (
          <CountRows rows={classRows} />
        )}
      </Section>
    </div>
  );
}

function Filters({
  filters,
  setFilters,
  classes,
  base,
}: {
  filters: PageFilters;
  setFilters: (next: PageFilters) => void;
  classes: ProjectClass[];
  base: DatasetSummary;
}) {
  const names = useOriginNames();
  const classIds = classes.map((item) => item.id);
  const slideIds = base.slides.map((slide) => slide.slide_id);
  const shown = checkedOrigins.filter(
    (origin) => !drawnOrigins.has(origin) || (base.objects[origin] ?? 0) > 0,
  );
  const picked = shown.filter((origin) => filters.origins.includes(origin));
  return (
    <aside className="grid content-start gap-4" data-testid="dataset-filters">
      <Section title={<Trans>Origin</Trans>}>
        {shown.map((origin: CheckedOrigin) => (
          <Choice
            key={origin}
            testId={`filter-origin-${origin}`}
            label={names[origin]}
            checked={filters.origins.includes(origin)}
            disabled={picked.length === 1 && filters.origins.includes(origin)}
            onChange={() => setFilters({ ...filters, origins: toggled(filters.origins, origin) })}
          />
        ))}
        <Choice
          testId="filter-include-unchecked"
          label={<Trans>Include AI objects nobody checked</Trans>}
          checked={filters.includeUnchecked}
          onChange={() => setFilters({ ...filters, includeUnchecked: !filters.includeUnchecked })}
        />
      </Section>
      {classes.length === 0 ? null : (
        <Section title={<Trans>Class</Trans>}>
          {classes.map((item) => (
            <Choice
              key={item.id}
              testId={`filter-class-${item.key}`}
              label={item.name}
              checked={filters.classIds === null || filters.classIds.includes(item.id)}
              onChange={() =>
                setFilters({ ...filters, classIds: narrowed(filters.classIds, classIds, item.id) })
              }
            />
          ))}
          <small className="text-caption text-fg-dim">
            <Trans>Objects with no class go in only while every class is chosen.</Trans>
          </small>
        </Section>
      )}
      <Section title={<Trans>Signed off slides</Trans>}>
        {base.slides.map((slide) => (
          <Choice
            key={slide.slide_id}
            testId={`filter-slide-${slide.label}`}
            label={slide.label}
            checked={filters.slideIds === null || filters.slideIds.includes(slide.slide_id)}
            onChange={() =>
              setFilters({
                ...filters,
                slideIds: narrowed(filters.slideIds, slideIds, slide.slide_id),
              })
            }
          />
        ))}
      </Section>
    </aside>
  );
}

function VersionRow({
  version,
  onDownload,
  onPatches,
}: {
  version: DatasetVersion;
  onDownload: () => void;
  onPatches: () => void;
}) {
  const { t } = useLingui();
  const when = whenText(version.created_at);
  const total = totalOf(version.counts.objects);
  return (
    <li
      className="grid gap-1 border-line border-t py-3 first:border-t-0"
      data-testid={`dataset-version-${version.number}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-fg">
          <Trans>Version {version.number}</Trans>
        </span>
        <span className="flex gap-2">
          <Button
            variant="ghost"
            data-testid={`dataset-version-${version.number}-download`}
            onClick={onDownload}
          >
            <Trans>Download</Trans>
          </Button>
          <Button
            variant="ghost"
            data-testid={`dataset-version-${version.number}-patches`}
            onClick={onPatches}
          >
            <Trans>Cut patches</Trans>
          </Button>
        </span>
      </div>
      {version.note ? <p className="m-0 text-body-sm text-fg">{version.note}</p> : null}
      <p className="m-0 text-caption text-fg-dim">
        {version.created_by === null
          ? t`${objectsLine(total, version.counts.slides.length)}, frozen by a service on ${when}`
          : t`${objectsLine(total, version.counts.slides.length)}, frozen by ${version.created_by} on ${when}`}
      </p>
      <p className="m-0 text-caption text-fg-dim">
        <Trans>
          SHA-256 {shortChecksum(version.sha256)}, {sizeText(version.bytes)}
        </Trans>
      </p>
    </li>
  );
}

export function DatasetScreen({ taskId }: { taskId: string }) {
  const { t } = useLingui();
  const renderLink = useRouterLink();
  const queryClient = useQueryClient();
  const toast = useScreenToast();
  const [filters, setFilters] = useState<PageFilters>(startingFilters);
  const [note, setNote] = useState("");
  const [patchesOf, setPatchesOf] = useState<number | null>(null);
  const task = okData(useGetReviewTask(taskId).data);
  const project = okData(
    useGetProject(task?.project_id ?? "", { query: { enabled: Boolean(task) } }).data,
  );
  const statesQuery = useGetReviewTaskStates(taskId, {
    query: { enabled: task?.kind === "review" },
  });
  const states = okData(statesQuery.data);
  const known = task !== undefined && (task.kind !== "review" || !statesQuery.isPending);
  const notSignedOff = task?.kind === "review" && states !== undefined && !states.signed_off_at;
  const asking = known && !notSignedOff;
  const baseQuery = useGetTaskDataset(
    taskId,
    { include_unchecked: false },
    { query: { enabled: asking } },
  );
  const base = okData(baseQuery.data);
  const summary = okData(
    useGetTaskDataset(taskId, datasetParams(filters), {
      query: { placeholderData: keepPreviousData, enabled: asking },
    }).data,
  );
  const versions = okData(useListDatasetVersions(taskId).data) ?? [];
  const freeze = useFreezeDatasetVersion();
  const rebuild = useBuildFinalLayer();
  const review = task?.kind === "review";
  const classes = task?.classes ?? base?.class_names ?? [];
  const code = task?.code ?? "";
  usePageTitleDetail(code || null);

  const freezeNow = () => {
    freeze.mutate(
      { taskId, data: { note, filters: freezeFilters(filters) } },
      {
        onSuccess: (response) => {
          if (response.status !== 201) return;
          setNote("");
          void queryClient.invalidateQueries({ queryKey: getListDatasetVersionsQueryKey(taskId) });
          toast.show(t`Version ${response.data.number} is frozen`);
        },
        onError: (error) => toast.show(refusalText(problemCode(error))),
      },
    );
  };

  const buildNow = () => {
    rebuild.mutate(
      { taskId },
      {
        onSuccess: (response) => {
          if (response.status !== 200) return;
          void queryClient.invalidateQueries({ queryKey: getGetTaskDatasetQueryKey(taskId) });
          toast.show(t`Final layer build ${response.data.build} is ready`);
        },
        onError: (error) => toast.show(refusalText(problemCode(error))),
      },
    );
  };

  const download = async (number: number) => {
    const result = await downloadDatasetVersion(taskId, number);
    toast.show(result.state === "saved" ? t`Saved ${result.name}` : refusalText(result.code));
  };

  const refusedCode = baseQuery.isError ? problemCode(baseQuery.error) : null;
  const unsignedReview =
    notSignedOff ||
    (review && (refusedCode === "nothing-signed-off" || refusedCode === "task-not-signed-off"));
  const refusal = unsignedReview
    ? refusalText("task-not-signed-off")
    : baseQuery.isError
      ? refusalText(refusedCode)
      : null;

  return (
    <main
      className="flex min-h-0 flex-1 flex-col gap-(--density-flow-gap) overflow-auto px-7 pt-5 pb-5"
      data-testid="dataset-screen"
    >
      <header className="grid gap-1">
        <Breadcrumbs
          renderLink={renderLink}
          items={[
            { label: t`My work`, href: destinations.myWork() },
            {
              label: project?.name ?? t`Project`,
              ...(task ? { href: destinations.project(task.project_id) } : {}),
            },
            {
              label: `${code} · ${task?.name ?? ""}`,
              ...(task ? { href: `${destinations.project(task.project_id)}?tab=tasks` } : {}),
            },
            { label: t`Dataset` },
          ]}
        />
        <h1 className="m-0 text-page-title font-semibold tracking-[-0.01em] text-fg">
          <Trans>Dataset of {code}</Trans>
        </h1>
        <p className="m-0 text-body-sm text-fg-dim">
          {review ? (
            <Trans>
              A review task goes in once it is signed off, through its final layer. Only objects a
              person checked go in: added, agreed and edited. Unsure and open objects are left out
              and counted. Freeze a version to name exactly which data trained a model.
            </Trans>
          ) : (
            <Trans>
              Only signed off slides go in. By default only objects a person checked go in: added,
              agreed and edited. Freeze a version to name exactly which data trained a model.
            </Trans>
          )}
        </p>
      </header>
      {review && !unsignedReview ? (
        <FinalLayer status={base?.final_layer} building={rebuild.isPending} onBuild={buildNow} />
      ) : null}
      {refusal !== null ? (
        <p role="alert" className="m-0 text-body text-bad" data-testid="dataset-refusal">
          {refusal}
        </p>
      ) : base === undefined || summary === undefined ? (
        <Loader label={t`Counting the dataset`} size="page" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
          <Filters filters={filters} setFilters={setFilters} classes={classes} base={base} />
          <div className="grid content-start gap-5">
            <Counts summary={summary} classes={classes} />
            <Section title={<Trans>Freeze a version</Trans>}>
              <p className="m-0 text-body-sm text-fg-dim">
                <Trans>
                  Stores the manifest and the GeoJSON of these filters once, with a number and a
                  checksum. Nobody can change a frozen version.
                </Trans>
              </p>
              <label className="grid gap-1 text-body-sm text-fg" htmlFor="dataset-note">
                <span>
                  <Trans>Note</Trans>
                </span>
                <Textarea
                  id="dataset-note"
                  data-testid="dataset-note"
                  maxLength={500}
                  value={note}
                  placeholder={t`What this version is for, such as the model it trains`}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <div>
                <Button
                  variant="primary"
                  data-testid="dataset-freeze"
                  disabled={freeze.isPending || totalOf(summary.objects) === 0}
                  onClick={freezeNow}
                >
                  <Trans>Freeze a version</Trans>
                </Button>
              </div>
            </Section>
            <Section title={<Trans>Versions</Trans>}>
              {versions.length === 0 ? (
                <p className="m-0 text-body-sm text-fg-dim" data-testid="dataset-no-versions">
                  <Trans>No version is frozen yet.</Trans>
                </p>
              ) : (
                <ul className="m-0 list-none p-0" data-testid="dataset-versions">
                  {versions.map((version) => (
                    <VersionRow
                      key={version.id}
                      version={version}
                      onDownload={() => void download(version.number)}
                      onPatches={() => setPatchesOf(version.number)}
                    />
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
      {patchesOf === null ? null : (
        <Suspense fallback={null}>
          <PatchExportDialog
            taskId={taskId}
            datasetVersion={patchesOf}
            onClose={() => setPatchesOf(null)}
          />
        </Suspense>
      )}
      {toast.node}
    </main>
  );
}
