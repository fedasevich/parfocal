import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type Project,
  type ProjectOverview,
  type ResultSet,
  type SlideRow as SlideRowData,
  useGetProjectOverview,
  useListCases,
  useListMySlides,
  useListProjectResultSets,
  useListSlideResultSets,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Input } from "@parfocal/ui/components/input";
import { Person } from "@parfocal/ui/components/person";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { SkeletonRows } from "@parfocal/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { FilterChip } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, type ReactNode, useState } from "react";
import { useFormat } from "../../format.ts";
import { SlideViewers, useProjectViewers } from "../../presence/viewing-now.tsx";
import { dotJoin } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { SlideThumb } from "../slide-thumb.tsx";
import { CaseSlidesEditor } from "./case-slides-editor.tsx";
import { failureText } from "./new-forms-model.ts";
import { usePeople } from "./people.ts";
import { ResultSetDeleteDialog } from "./result-set-delete-dialog.tsx";
import { isFiltering, matchesFilters, noFilters, type SlideFilters } from "./slide-filter-model.ts";
import { type SlideToast, useSlideMove } from "./slide-move-action.ts";
import { SlideMoveDialog } from "./slide-move-dialog.tsx";
import { canDrop, dragReason, moveTitle, slideDragType } from "./slide-move-model.ts";
import { reviewersOf } from "./slide-reviews.ts";

type ProjectSlide = SlideRowData & {
  file: string;
  stain: string;
  remote: string | null;
};

type Group = {
  key: string;
  label: ReactNode;
  sub: string;
  count: number;
  slides: ProjectSlide[];
};

const reviewLook: Record<string, { text: string; tone: string }> = {
  submitted: { text: "submitted", tone: "text-ok" },
  "in-review": { text: "in review", tone: "text-accent" },
  assigned: { text: "assigned", tone: "text-fg-faint" },
};

const withVersion = (name: string, version: string | null) =>
  version ? `${name} ${version}` : name;

const setName = (set: Pick<ResultSet, "name" | "model_version">) =>
  withVersion(set.name.split(" ")[0] ?? set.name, set.model_version);

const slideTitle = (slide: ProjectSlide) => `${slide.label} · ${slide.stain}`;

const headRow = "[&>th]:sticky [&>th]:top-0 [&>th]:z-1 [&>th]:bg-surf-panel";
const headCell = "px-4 py-(--density-head-y)";

export function useProjectSlides(projectId: string): ProjectSlide[] {
  return useProjectSlideRows(projectId).slides;
}

function useProjectSlideRows(projectId: string): { slides: ProjectSlide[]; loading: boolean } {
  const rowsQuery = useListMySlides({ project_id: projectId });
  const overviewQuery = useGetProjectOverview(projectId);
  const rows = okData(rowsQuery.data)?.slides ?? [];
  const files = okData(overviewQuery.data)?.slide_files ?? [];
  const slides = rows.map((row) => {
    const file = files.find((item) => item.slide_id === row.id);
    return {
      ...row,
      file: file?.file ?? row.label,
      stain: file?.stain ?? "H&E",
      remote: file?.remote ?? null,
    };
  });
  return { slides, loading: rowsQuery.isPending || overviewQuery.isPending };
}

function groupSlides(slides: ProjectSlide[], overview: ProjectOverview | undefined): Group[] {
  const cases = overview?.case_groups ?? [];
  const groups: Group[] = cases.map((item) => ({
    key: item.label,
    label: (
      <>
        <Trans>
          Case <span className="font-mono">{item.label}</span>
        </Trans>
      </>
    ),
    sub: t`${item.slide_count} slide${item.slide_count === 1 ? "" : "s"} · ${item.specimen.toLowerCase()}`,
    count: item.slide_count,
    slides: slides.filter((slide) => slide.case_label === item.label),
  }));
  const known = new Set(cases.map((item) => item.label));
  for (const label of new Set(slides.map((slide) => slide.case_label))) {
    if (label === null || known.has(label)) continue;
    const own = slides.filter((slide) => slide.case_label === label);
    groups.push({
      key: label,
      label: (
        <>
          <Trans>
            Case <span className="font-mono">{label}</span>
          </Trans>
        </>
      ),
      sub: `${own.length} slide${own.length === 1 ? "" : "s"}`,
      count: own.length,
      slides: own,
    });
  }
  const loose = slides.filter((slide) => slide.case_label === null);
  if (loose.length > 0) {
    groups.push({
      key: "loose",
      label: t`Loose slides`,
      sub: t`${loose.length} slide${loose.length === 1 ? "" : "s"}, no case`,
      count: loose.length,
      slides: loose,
    });
  }
  return groups;
}

export function SlidesTab({
  project,
  open,
  toast,
}: {
  project: Project;
  open: string | undefined;
  toast: SlideToast;
}) {
  const { t } = useLingui();

  const { slides, loading } = useProjectSlideRows(project.id);
  const viewersOf = useProjectViewers(project.id);
  const overview = okData(useGetProjectOverview(project.id).data);
  const sets = okData(useListProjectResultSets(project.id).data) ?? [];
  const navigate = useNavigate();
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ id: string; label: string } | undefined>();
  const [moving, setMoving] = useState<ProjectSlide | undefined>();
  const caseList = okData(useListCases({ project_id: project.id }).data) ?? [];
  const caseIdOf = (label: string) => caseList.find((item) => item.label === label)?.id;
  const owner = project.my_role === "owner";
  const move = useSlideMove(toast);
  const [dragged, setDragged] = useState<ProjectSlide | undefined>();
  const [over, setOver] = useState<string | undefined>();
  const labelOf = (group: Group) => (group.key === "loose" ? null : group.key);
  const takes = (group: Group) =>
    dragged !== undefined &&
    canDrop(dragged.case_label, labelOf(group)) &&
    (group.key === "loose" || caseIdOf(group.key) !== undefined);
  const endDrag = () => {
    setDragged(undefined);
    setOver(undefined);
  };
  const dropOn = (group: Group) => {
    const slide = dragged;
    endDrag();
    if (slide === undefined || !takes(group)) return;
    const label = labelOf(group);
    void move(
      {
        id: slide.id,
        title: slideTitle(slide),
        fromCaseId: slide.case_label === null ? null : (caseIdOf(slide.case_label) ?? null),
        fromLabel: slide.case_label,
      },
      { caseId: label === null ? null : (caseIdOf(label) ?? null), label },
      dragReason(label),
    ).catch((error: unknown) => toast(failureText(error).failure));
  };
  const [filters, setFilters] = useState<SlideFilters>(noFilters);
  const filtering = isFiltering(filters);
  const shown = slides.filter((slide) => matchesFilters(slide, filters));
  const groups = groupSlides(shown, overview)
    .map((group) =>
      filtering
        ? {
            ...group,
            count: group.slides.length,
            sub: t`${group.slides.length} matching slide${group.slides.length === 1 ? "" : "s"}`,
          }
        : group,
    )
    .filter((group) => !filtering || group.slides.length > 0);
  if (dragged !== undefined && !groups.some((group) => group.key === "loose")) {
    groups.push({
      key: "loose",
      label: t`Loose slides`,
      sub: t`Drop here to take a slide out of its case`,
      count: 0,
      slides: [],
    });
  }
  const isOpen = (group: Group, index: number) => {
    if (filtering) return true;
    if (shut[group.key] === undefined) return index === 0 || group.key === "loose";
    return !shut[group.key];
  };
  return (
    <>
      <div className="flex flex-none flex-wrap items-center gap-2.5">
        <div className="relative w-70 max-w-full">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint"
          />
          <Input
            aria-label={t`Filter by slide, file or case`}
            placeholder={t`Filter by slide, file or case`}
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            className="h-7 pl-8 text-caption"
          />
        </div>
        <Select
          value={filters.resultSetId}
          onValueChange={(value) => setFilters({ ...filters, resultSetId: String(value) })}
          items={[
            { value: "any", label: "Any result set" },
            ...sets.map((set) => ({ value: set.id, label: setName(set) })),
          ]}
        >
          <SelectTrigger size="sm" aria-label={t`Result set`} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any result set</SelectItem>
            {sets.map((set) => (
              <SelectItem key={set.id} value={set.id}>
                {setName(set)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FilterChip
          pressed={filters.needsReview}
          onPressedChange={(needsReview) => setFilters({ ...filters, needsReview })}
        >
          <Trans>Needs review</Trans>{" "}
          <span className="font-mono">{overview?.needs_review ?? 0}</span>
        </FilterChip>
        <FilterChip
          pressed={filters.noResults}
          onPressedChange={(noResults) => setFilters({ ...filters, noResults })}
        >
          <Trans>No results</Trans> <span className="font-mono">{overview?.no_results ?? 0}</span>
        </FilterChip>
        <span className="flex-1" />
        <span className="inline-flex min-w-0 items-center gap-1.5 text-body-sm text-fg-dim">
          <Icon name="upload" />
          <Trans>Drop files anywhere here to upload into {project.code}</Trans>
        </span>
      </div>
      <div
        data-testid="slides-table"
        className="min-h-0 flex-1 overflow-auto rounded-zone border border-line bg-surf-panel"
      >
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow className={headRow}>
              <TableHead className={cn(headCell, "w-[27%]")}>
                <Trans>Slide</Trans>
              </TableHead>
              <TableHead className={cn(headCell, "w-[33%]")}>
                <Trans>Result sets</Trans>
              </TableHead>
              <TableHead className={headCell}>
                <Trans>Reviews</Trans>
              </TableHead>
              <TableHead className={headCell}>
                <span className="sr-only">
                  <Trans>Open</Trans>
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="p-0">
                  <SkeletonRows label={t`Loading slides`} rows={6} columns={4} />
                </TableCell>
              </TableRow>
            ) : null}
            {filtering && groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="px-4 py-6 text-center text-fg-dim">
                  <Trans>No slides match these filters.</Trans>
                </TableCell>
              </TableRow>
            ) : null}
            {(loading ? [] : groups).map((group, index) => {
              const expanded = isOpen(group, index);
              return (
                <Fragment key={group.key}>
                  <TableRow
                    data-testid="case-group"
                    data-group={group.key}
                    data-drop={dragged === undefined ? undefined : takes(group) ? "ready" : "off"}
                    className="cursor-pointer"
                    onClick={() => setShut({ ...shut, [group.key]: expanded })}
                    onDragOver={(event) => {
                      if (!takes(group)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (over !== group.key) setOver(group.key);
                    }}
                    onDragLeave={() => {
                      if (over === group.key) setOver(undefined);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropOn(group);
                    }}
                  >
                    <TableCell
                      colSpan={4}
                      className={cn(
                        "bg-surf-section px-4 py-2.5 whitespace-normal",
                        dragged !== undefined &&
                          takes(group) &&
                          "outline-1 -outline-offset-1 outline-dashed outline-line-strong",
                        over === group.key && "bg-surf-hl outline-2 outline-solid outline-accent",
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-fg-dim">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          className="inline-flex min-h-6 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-fg-dim"
                        >
                          <Icon name={expanded ? "down" : "next"} />
                          <b className="font-semibold text-fg">{group.label}</b>
                        </button>
                        <span>{group.sub}</span>
                        {owner && group.key !== "loose" && caseIdOf(group.key) ? (
                          <span className="ml-auto flex gap-1">
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={(event) => {
                                event.stopPropagation();
                                const id = caseIdOf(group.key);
                                if (id) {
                                  void navigate({
                                    to: "/projects/$projectId/cases/$caseId/upload",
                                    params: { projectId: project.id, caseId: id },
                                  });
                                }
                              }}
                            >
                              <Trans>Upload slides</Trans>
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={(event) => {
                                event.stopPropagation();
                                const id = caseIdOf(group.key);
                                if (id) setEditing({ id, label: group.key });
                              }}
                            >
                              <Trans>Edit slides</Trans>
                            </Button>
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                  {expanded
                    ? group.slides.map((slide) => (
                        <SlideRow
                          key={slide.id}
                          project={project}
                          slide={slide}
                          sets={sets}
                          viewers={viewersOf(slide.id)}
                          expanded={open === slide.id}
                          onMove={owner ? () => setMoving(slide) : undefined}
                          onDragStart={owner ? () => setDragged(slide) : undefined}
                          onDragEnd={endDrag}
                        />
                      ))
                    : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {moving ? (
        <SlideMoveDialog
          key={moving.id}
          projectId={project.id}
          slideId={moving.id}
          slideTitle={slideTitle(moving)}
          caseLabel={moving.case_label}
          toast={toast}
          onClose={() => setMoving(undefined)}
        />
      ) : null}
      {editing ? (
        <CaseSlidesEditor
          caseId={editing.id}
          caseLabel={editing.label}
          clinical={project.privacy_mode === "clinical"}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

function SlideRow({
  project,
  slide,
  sets,
  viewers,
  expanded,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  project: Project;
  slide: ProjectSlide;
  sets: ResultSet[];
  viewers: string[];
  expanded: boolean;
  onMove: (() => void) | undefined;
  onDragStart: (() => void) | undefined;
  onDragEnd: () => void;
}) {
  const { t } = useLingui();

  const navigate = useNavigate();
  const people = usePeople();
  const own = slide.result_sets.flatMap((ref) => sets.filter((set) => set.id === ref.id));
  const target = {
    to: "/projects/$projectId/slides/$slideId/live",
    params: { projectId: project.id, slideId: slide.id },
  } as const;
  const open = () => void navigate(target);
  const toggle = () =>
    void navigate({
      to: "/projects/$projectId",
      params: { projectId: project.id },
      search: { tab: "slides", sets: expanded ? undefined : slide.id },
    });
  return (
    <>
      <TableRow
        data-testid="slide-row"
        draggable={onDragStart !== undefined}
        onDragStart={(event) => {
          if (onDragStart === undefined) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(slideDragType, slide.id);
          event.dataTransfer.setData("text/plain", slideTitle(slide));
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className={cn(
          "group cursor-pointer [&>td]:px-4 [&>td]:py-(--density-list-row-y) [&>td]:whitespace-normal",
          expanded && "border-b-transparent [&>td]:bg-surf-hl",
        )}
        onClick={open}
      >
        <TableCell>
          <span data-testid="slide-name-cell" className="flex min-w-36 items-center gap-3">
            <Link
              {...target}
              data-testid="slide-link"
              draggable={false}
              onClick={(event) => event.stopPropagation()}
              className="flex min-w-0 items-center gap-3 text-inherit no-underline"
            >
              <SlideThumb
                slideId={slide.id}
                file={slide.file}
                className="h-7.5 w-11 flex-none overflow-hidden rounded-md border border-line"
              />
              <span className="grid min-w-0 gap-0.5">
                <b
                  data-testid="slide-title"
                  className="font-semibold [overflow-wrap:anywhere] text-fg"
                >
                  {slideTitle(slide)}
                </b>
                <small className="max-w-70 truncate font-mono text-caption text-fg-faint">
                  {slide.file}
                </small>
              </span>
            </Link>
            <SlideViewers viewers={viewers} />
            {slide.remote ? (
              <span
                title={t`Read in place from ${slide.remote}. Nothing copied.`}
                className="ml-2 inline-flex h-4.5 items-center gap-1 rounded-sm bg-[rgb(56_189_248/0.14)] px-1.5 text-label font-semibold text-[#0369a1] dark:text-[#38bdf8]"
              >
                <Icon name="link" size="xs" />
                <Trans>remote</Trans>
              </span>
            ) : null}
          </span>
        </TableCell>
        <TableCell>
          {own.length > 0 ? (
            <button
              type="button"
              title={t`${expanded ? "Hide" : "Show"} the result sets of this slide`}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                toggle();
              }}
              className="-m-1 inline-flex max-w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-ctl text-left border-0 bg-transparent p-1 text-fg-dim hover:bg-[color-mix(in_srgb,var(--fg)_6%,transparent)]"
            >
              {own.map((set) => (
                <span
                  key={set.id}
                  title={`${withVersion(set.name, set.model_version)} · ${set.source === "import" ? t`imported from ${set.source_file ?? "a file"}` : "run here"}`}
                  data-testid="result-set-chip"
                  className="inline-flex min-h-5.5 max-w-full min-w-0 items-center gap-1.25 rounded-md border border-line bg-surf-section px-2 py-0.5 text-caption font-medium [overflow-wrap:anywhere] text-fg"
                >
                  <Icon name="layers" size="xs" />
                  {setName(set)}
                </span>
              ))}
              <Icon name={expanded ? "down" : "next"} />
            </button>
          ) : (
            <span className="inline-flex items-center gap-2.5">
              <span>
                <Trans>No results yet</Trans>
              </span>
              <Link
                to="/projects/$projectId/run-model"
                params={{ projectId: project.id }}
                search={{ slides: [slide.id] }}
                onClick={(event) => event.stopPropagation()}
                className="inline-flex min-h-6 items-center font-medium text-accent hover:underline"
              >
                <Trans>Run a model</Trans>
              </Link>
            </span>
          )}
        </TableCell>
        <TableCell>
          {slide.reviews.length > 0 ? (
            <span className="flex flex-wrap gap-x-5.5 gap-y-1.5">
              {reviewersOf(slide.reviews).map((review) => (
                <span
                  key={review.user_id}
                  className={reviewLook[review.state]?.tone ?? "text-fg-faint"}
                >
                  <Person
                    person={people.byId(review.user_id)}
                    size={22}
                    sub={dotJoin([
                      reviewLook[review.state]?.text ?? review.state,
                      review.tasks > 1 ? `${review.tasks} tasks` : null,
                    ])}
                    className="[&_small]:text-current"
                  />
                </span>
              ))}
            </span>
          ) : (
            <span>
              <Trans>Nobody yet</Trans>
            </span>
          )}
        </TableCell>
        <TableCell className="w-px whitespace-nowrap">
          <span
            data-testid="slide-actions"
            className="flex flex-nowrap items-center justify-end gap-1.5"
          >
            {onMove ? (
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={(event) => {
                  event.stopPropagation();
                  onMove();
                }}
              >
                {moveTitle(slide.case_label !== null)}
              </Button>
            ) : null}
            <Button
              size="sm"
              className="shrink-0"
              nativeButton={false}
              render={<Link {...target} onClick={(event) => event.stopPropagation()} />}
            >
              <Trans>Open</Trans>
            </Button>
          </span>
        </TableCell>
      </TableRow>
      {expanded ? <ResultSetDetail project={project} slide={slide} /> : null}
    </>
  );
}

function ResultSetDetail({ project, slide }: { project: Project; slide: ProjectSlide }) {
  const { t } = useLingui();

  const sets = okData(useListSlideResultSets(slide.id).data) ?? [];
  const people = usePeople();
  const format = useFormat();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<ResultSet | undefined>();
  const view = () =>
    void navigate({
      to: "/projects/$projectId/slides/$slideId",
      params: { projectId: project.id, slideId: slide.id },
    });
  return (
    <TableRow>
      <TableCell colSpan={4} className="bg-surf-hl pr-4 pb-3.5 pl-18 whitespace-normal">
        <div className="grid gap-1.5" data-testid="result-sets">
          {sets.map((set) => (
            <div
              key={set.id}
              className="grid grid-cols-[16px_minmax(0,1fr)_170px_170px_auto] items-center gap-3.5 rounded-ctl border border-line bg-surf-panel px-3 py-[calc(var(--density-cell-y)+1px)]"
            >
              <Icon name="layers" className="text-fg-dim" />
              <span className="min-w-0">
                <b className="block text-body-sm text-fg">
                  {set.name} <span className="font-normal text-fg-dim">{set.model_version}</span>
                </b>
                <small className="block truncate text-caption text-fg-dim">
                  {set.source === "import"
                    ? t`Imported from ${set.source_file ?? "a file"}`
                    : t`Run here on the lab server`}
                </small>
              </span>
              <span className="text-body-sm text-fg-dim">
                <Trans>{set.region_count} regions</Trans>
                {set.cell_count ? t` · ${format.integer(set.cell_count)} cells` : ""}
              </span>
              <Person
                person={people.byId(set.created_by_user_id)}
                size={20}
                sub={`added ${format.dateShort(new Date(set.created_at))}`}
              />
              <span className="flex gap-0.5">
                <Button size="sm" variant="ghost" onClick={view}>
                  <Icon name="eye" />
                  <Trans>Show</Trans>
                </Button>
                <Button size="sm" variant="ghost" onClick={view}>
                  <Icon name="slides" />
                  <Trans>Compare</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t`Delete ${set.name}`}
                  onClick={() => setDeleting(set)}
                >
                  <Trans>Delete</Trans>
                </Button>
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 rounded-ctl border border-dashed border-line px-3 py-[calc(var(--density-cell-y)+1px)]">
            <span className="text-body-sm text-fg-dim">
              <Trans>Add another result set to {slide.label}</Trans>
            </span>
            <span className="flex-1" />
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/projects/$projectId/upload"
                  params={{ projectId: project.id }}
                  search={{ scene: "viewer" }}
                />
              }
            >
              <Icon name="upload" />
              <Trans>Upload a file</Trans>
            </Button>
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link to="/projects/$projectId/run-model" params={{ projectId: project.id }} />
              }
            >
              <Icon name="smart" />
              <Trans>Run a model</Trans>
            </Button>
          </div>
        </div>
        {deleting ? (
          <ResultSetDeleteDialog set={deleting} onClose={() => setDeleting(undefined)} />
        ) : null}
      </TableCell>
    </TableRow>
  );
}
