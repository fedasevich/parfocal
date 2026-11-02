import {
  type Project,
  type ProjectOverview,
  type ResultSet,
  type SlideRow as SlideRowData,
  useGetProjectOverview,
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
import { FilterChip } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, type ReactNode, useState } from "react";
import { okData } from "../placeholder.tsx";
import { usePeople } from "./people.ts";

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

const setName = (set: Pick<ResultSet, "name" | "model_version">) =>
  `${set.name.split(" ")[0] ?? set.name} ${set.model_version}`;

const slideTitle = (slide: ProjectSlide) => `${slide.label} · ${slide.stain}`;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

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
  const overview = useGetProjectOverview(project.id).data?.data;
  const sets = okData(useListProjectResultSets(project.id).data) ?? [];
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const groups = groupSlides(slides, overview);
  const isOpen = (group: Group, index: number) =>
    shut[group.key] === undefined ? index === 0 || group.key === "loose" : !shut[group.key];
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
            className="h-7 pl-8 text-caption"
          />
        </div>
        <Select
          defaultValue="any"
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
        <FilterChip onClick={() => toast("Shows slides with reviews still open (mock)")}>
          Needs review <span className="font-mono">{overview?.needs_review ?? 0}</span>
        </FilterChip>
        <FilterChip onClick={() => toast("Shows slides without any result set (mock)")}>
          No results <span className="font-mono">{overview?.no_results ?? 0}</span>
        </FilterChip>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1.5 text-body-sm text-fg-dim">
          <Icon name="upload" />
          Drop files anywhere here to upload into {project.code}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-zone border border-line bg-surf-panel">
        <table className="w-full border-collapse text-body-sm">
          <thead>
            <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-1 [&>th]:border-b [&>th]:border-line [&>th]:bg-surf-panel [&>th]:px-4 [&>th]:py-2.75 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-fg-dim">
              <th className="w-[27%]">Slide</th>
              <th className="w-[33%]">Result sets</th>
              <th>Reviews</th>
              <th>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, index) => {
              const expanded = isOpen(group, index);
              return (
                <Fragment key={group.key}>
                  <tr
                    aria-expanded={expanded}
                    className="cursor-pointer"
                    onClick={() => setShut({ ...shut, [group.key]: expanded })}
                  >
                    <td colSpan={4} className="border-b border-line bg-surf-section px-4 py-2.5">
                      <span className="flex items-center gap-2.5 text-fg-dim">
                        <Icon name={expanded ? "down" : "next"} />
                        <b className="font-semibold text-fg">{group.label}</b>
                        <span>{group.sub}</span>
                      </span>
                    </td>
                  </tr>
                  {expanded
                    ? group.slides.map((slide) => (
                        <SlideRow
                          key={slide.id}
                          project={project}
                          slide={slide}
                          sets={sets}
                          expanded={open === slide.id}
                          toast={toast}
                        />
                      ))
                    : null}
                  {expanded && group.count > group.slides.length ? (
                    <tr>
                      <td colSpan={4} className="border-b border-line py-2.5 pr-4 pl-18">
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
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SlideRow({
  project,
  slide,
  sets,
  expanded,
  toast,
}: {
  project: Project;
  slide: ProjectSlide;
  sets: ResultSet[];
  expanded: boolean;
  toast: (message: ReactNode) => void;
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
      <tr
        data-testid="slide-row"
        className={cn(
          "group cursor-pointer [&>td]:border-b [&>td]:border-line [&>td]:px-4 [&>td]:py-3 [&>td]:text-fg-dim",
          expanded
            ? "[&>td]:border-b-transparent [&>td]:bg-surf-hl"
            : "hover:[&>td]:bg-[color-mix(in_srgb,var(--fg)_3%,transparent)]",
        )}
        onClick={open}
      >
        <td>
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
            {slide.remote ? (
              <span
                title={`Read in place from ${slide.remote}. Nothing copied.`}
                className="ml-2 inline-flex h-4.5 items-center gap-1 rounded-sm bg-[rgb(56_189_248/0.14)] px-1.5 text-label font-semibold text-[#38bdf8]"
              >
                <Icon name="link" size="xs" />
                remote
              </span>
            ) : null}
          </span>
        </td>
        <td>
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
                  title={`${set.name} ${set.model_version} · ${set.source === "import" ? `imported from ${set.source_file ?? "a file"}` : "run here"}`}
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
                className="font-medium text-accent hover:underline"
              >
                Run a model
              </Link>
            </span>
          )}
        </td>
        <td>
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
        </td>
        <td className="w-px text-right whitespace-nowrap">
          <Button size="sm" onClick={open}>
            Open
          </Button>
        </td>
      </tr>
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
  const navigate = useNavigate();
  const view = () =>
    void navigate({
      to: "/projects/$projectId/slides/$slideId",
      params: { projectId: project.id, slideId: slide.id },
    });
  return (
    <tr>
      <td colSpan={4} className="border-b border-line bg-surf-hl pr-4 pb-3.5 pl-18">
        <div className="grid gap-1.5" data-testid="result-sets">
          {sets.map((set) => (
            <div
              key={set.id}
              className="grid grid-cols-[16px_minmax(0,1fr)_170px_170px_auto] items-center gap-3.5 rounded-ctl border border-line bg-surf-panel px-3 py-2.25"
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
                {set.cell_count ? ` · ${set.cell_count.toLocaleString("en-US")} cells` : ""}
              </span>
              <Person
                person={people.byId(set.created_by_user_id)}
                size={20}
                sub={`added ${shortDate(set.created_at)}`}
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
          <div className="flex items-center gap-2 rounded-ctl border border-dashed border-line px-3 py-2.25">
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
      </td>
    </tr>
  );
}
