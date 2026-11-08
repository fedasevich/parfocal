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
import { okData } from "../placeholder.tsx";
import { CaseSlidesEditor } from "./case-slides-editor.tsx";
import { usePeople } from "./people.ts";
import { isFiltering, matchesFilters, noFilters, type SlideFilters } from "./slide-filter-model.ts";
import { SlideMoveDialog } from "./slide-move-dialog.tsx";
import { moveTitle } from "./slide-move-model.ts";

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
  const rows = okData(useListMySlides({ project_id: projectId }).data)?.slides ?? [];
  const files = useGetProjectOverview(projectId).data?.data.slide_files ?? [];
  return rows.map((row) => {
    const file = files.find((item) => item.slide_id === row.id);
    return {
      ...row,
      file: file?.file ?? row.label,
      stain: file?.stain ?? "H&E",
      remote: file?.remote ?? null,
    };
  });
}

function groupSlides(slides: ProjectSlide[], overview: ProjectOverview | undefined): Group[] {
  const cases = overview?.case_groups ?? [];
  const groups: Group[] = cases.map((item) => ({
    key: item.label,
    label: (
      <>
        Case <span className="font-mono">{item.label}</span>
      </>
    ),
    sub: `${item.slide_count} slide${item.slide_count === 1 ? "" : "s"} · ${item.specimen.toLowerCase()}`,
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
          Case <span className="font-mono">{label}</span>
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
      label: "Loose slides",
      sub: `${loose.length} slide${loose.length === 1 ? "" : "s"}, no case`,
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
  toast: (message: ReactNode) => void;
}) {
  const slides = useProjectSlides(project.id);
  const viewersOf = useProjectViewers(project.id);
  const overview = useGetProjectOverview(project.id).data?.data;
  const sets = okData(useListProjectResultSets(project.id).data) ?? [];
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ id: string; label: string } | undefined>();
  const [moving, setMoving] = useState<ProjectSlide | undefined>();
  const caseList = okData(useListCases({ project_id: project.id }).data) ?? [];
  const caseIdOf = (label: string) => caseList.find((item) => item.label === label)?.id;
  const owner = project.my_role === "owner";
  const [filters, setFilters] = useState<SlideFilters>(noFilters);
  const filtering = isFiltering(filters);
  const shown = slides.filter((slide) => matchesFilters(slide, filters));
  const groups = groupSlides(shown, overview)
    .map((group) =>
      filtering
        ? {
            ...group,
            count: group.slides.length,
            sub: `${group.slides.length} matching slide${group.slides.length === 1 ? "" : "s"}`,
          }
        : group,
    )
    .filter((group) => !filtering || group.slides.length > 0);
  const isOpen = (group: Group, index: number) => {
    if (filtering) return true;
    if (shut[group.key] === undefined) return index === 0 || group.key === "loose";
    return !shut[group.key];
  };
  return (
    <>
      <div className="flex flex-none items-center gap-2.5">
        <div className="relative w-70">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint"
          />
          <Input
            aria-label="Filter by slide, file or case"
            placeholder="Filter by slide, file or case"
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
          <SelectTrigger size="sm" aria-label="Result set" className="w-40">
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
          Needs review <span className="font-mono">{overview?.needs_review ?? 0}</span>
        </FilterChip>
        <FilterChip
          pressed={filters.noResults}
          onPressedChange={(noResults) => setFilters({ ...filters, noResults })}
        >
          No results <span className="font-mono">{overview?.no_results ?? 0}</span>
        </FilterChip>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1.5 text-body-sm text-fg-dim">
          <Icon name="upload" />
          Drop files anywhere here to upload into {project.code}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-zone border border-line bg-surf-panel">
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow className={headRow}>
              <TableHead className={cn(headCell, "w-[27%]")}>Slide</TableHead>
              <TableHead className={cn(headCell, "w-[33%]")}>Result sets</TableHead>
              <TableHead className={headCell}>Reviews</TableHead>
              <TableHead className={headCell}>
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtering && groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="px-4 py-6 text-center text-fg-dim">
                  No slides match these filters.
                </TableCell>
              </TableRow>
            ) : null}
            {groups.map((group, index) => {
              const expanded = isOpen(group, index);
              return (
                <Fragment key={group.key}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setShut({ ...shut, [group.key]: expanded })}
                  >
                    <TableCell
                      colSpan={4}
                      className="bg-surf-section px-4 py-2.5 whitespace-normal"
                    >
                      <span className="flex items-center gap-2.5 text-fg-dim">
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
                          <Button
                            size="xs"
                            variant="ghost"
                            className="ml-auto"
                            onClick={(event) => {
                              event.stopPropagation();
                              const id = caseIdOf(group.key);
                              if (id) setEditing({ id, label: group.key });
                            }}
                          >
                            Edit slides
                          </Button>
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
                          toast={toast}
                          onMove={owner ? () => setMoving(slide) : undefined}
                        />
                      ))
                    : null}
                  {expanded && group.count > group.slides.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-2.5 pr-4 pl-18">
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline"
                          onClick={() =>
                            toast(
                              `Loads the other ${group.count - group.slides.length} slides of ${group.key} (mock)`,
                            )
                          }
                        >
                          Show all {group.count} slides
                        </button>
                      </TableCell>
                    </TableRow>
                  ) : null}
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
  toast,
  onMove,
}: {
  project: Project;
  slide: ProjectSlide;
  sets: ResultSet[];
  viewers: string[];
  expanded: boolean;
  toast: (message: ReactNode) => void;
  onMove: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const people = usePeople();
  const own = slide.result_sets.flatMap((ref) => sets.filter((set) => set.id === ref.id));
  const open = () =>
    void navigate({
      to: "/projects/$projectId/slides/$slideId/live",
      params: { projectId: project.id, slideId: slide.id },
    });
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
        className={cn(
          "group cursor-pointer [&>td]:px-4 [&>td]:py-(--density-list-row-y) [&>td]:whitespace-normal",
          expanded && "border-b-transparent [&>td]:bg-surf-hl",
        )}
        onClick={open}
      >
        <TableCell>
          <span className="inline-flex items-center gap-3">
            <i
              aria-hidden="true"
              className="h-7.5 w-11 flex-none rounded-md border border-line bg-cover bg-center"
              style={{ backgroundImage: "url(/mock-assets/overview.jpg)" }}
            />
            <span className="grid min-w-0 gap-0.5">
              <b className="font-semibold text-fg">{slideTitle(slide)}</b>
              <small className="max-w-70 truncate font-mono text-caption text-fg-faint">
                {slide.file}
              </small>
            </span>
            <SlideViewers viewers={viewers} />
            {slide.remote ? (
              <span
                title={`Read in place from ${slide.remote}. Nothing copied.`}
                className="ml-2 inline-flex h-4.5 items-center gap-1 rounded-sm bg-[rgb(56_189_248/0.14)] px-1.5 text-label font-semibold text-[#0369a1] dark:text-[#38bdf8]"
              >
                <Icon name="link" size="xs" />
                remote
              </span>
            ) : null}
          </span>
        </TableCell>
        <TableCell>
          {own.length > 0 ? (
            <button
              type="button"
              title={`${expanded ? "Hide" : "Show"} the result sets of this slide`}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                toggle();
              }}
              className="-m-1 inline-flex cursor-pointer flex-nowrap items-center gap-1.5 rounded-ctl border-0 bg-transparent p-1 text-fg-dim hover:bg-[color-mix(in_srgb,var(--fg)_6%,transparent)]"
            >
              {own.map((set) => (
                <span
                  key={set.id}
                  title={`${withVersion(set.name, set.model_version)} · ${set.source === "import" ? `imported from ${set.source_file ?? "a file"}` : "run here"}`}
                  className="inline-flex h-5.5 items-center gap-1.25 rounded-md border border-line bg-surf-section px-2 text-caption font-medium whitespace-nowrap text-fg"
                >
                  <Icon name="layers" size="xs" />
                  {setName(set)}
                </span>
              ))}
              <Icon name={expanded ? "down" : "next"} />
            </button>
          ) : (
            <span className="inline-flex items-center gap-2.5">
              <span>No results yet</span>
              <Link
                to="/projects/$projectId/run-model"
                params={{ projectId: project.id }}
                onClick={(event) => event.stopPropagation()}
                className="inline-flex min-h-6 items-center font-medium text-accent hover:underline"
              >
                Run a model
              </Link>
            </span>
          )}
        </TableCell>
        <TableCell>
          {slide.reviews.length > 0 ? (
            <span className="flex flex-wrap gap-x-5.5 gap-y-1.5">
              {slide.reviews.map((review) => (
                <span
                  key={`${review.task_code}-${review.user_id}`}
                  className={reviewLook[review.state]?.tone ?? "text-fg-faint"}
                >
                  <Person
                    person={people.byId(review.user_id)}
                    size={22}
                    sub={reviewLook[review.state]?.text ?? review.state}
                    className="[&_small]:text-current"
                  />
                </span>
              ))}
            </span>
          ) : (
            <span>Nobody yet</span>
          )}
        </TableCell>
        <TableCell className="w-px text-right whitespace-nowrap">
          {onMove ? (
            <Button
              size="sm"
              variant="ghost"
              className="mr-1"
              onClick={(event) => {
                event.stopPropagation();
                onMove();
              }}
            >
              {moveTitle(slide.case_label !== null)}
            </Button>
          ) : null}
          <Button size="sm" onClick={open}>
            Open
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? <ResultSetDetail project={project} slide={slide} toast={toast} /> : null}
    </>
  );
}

function ResultSetDetail({
  project,
  slide,
  toast,
}: {
  project: Project;
  slide: ProjectSlide;
  toast: (message: ReactNode) => void;
}) {
  const sets = okData(useListSlideResultSets(slide.id).data) ?? [];
  const people = usePeople();
  const format = useFormat();
  const navigate = useNavigate();
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
                    ? `Imported from ${set.source_file ?? "a file"}`
                    : "Run here on the lab server"}
                </small>
              </span>
              <span className="text-body-sm text-fg-dim">
                {set.region_count} regions
                {set.cell_count ? ` · ${format.integer(set.cell_count)} cells` : ""}
              </span>
              <Person
                person={people.byId(set.created_by_user_id)}
                size={20}
                sub={`added ${format.dateShort(new Date(set.created_at))}`}
              />
              <span className="flex gap-0.5">
                <Button size="sm" variant="ghost" onClick={view}>
                  <Icon name="eye" />
                  Show
                </Button>
                <Button size="sm" variant="ghost" onClick={view}>
                  <Icon name="slides" />
                  Compare
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    toast("Downloads this result set as Parfocal JSON, GeoJSON or CSV (mock)")
                  }
                >
                  <Icon name="download" />
                  Export
                </Button>
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 rounded-ctl border border-dashed border-line px-3 py-[calc(var(--density-cell-y)+1px)]">
            <span className="text-body-sm text-fg-dim">
              Add another result set to {slide.label}
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
              Upload a file
            </Button>
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link to="/projects/$projectId/run-model" params={{ projectId: project.id }} />
              }
            >
              <Icon name="smart" />
              Run a model
            </Button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
