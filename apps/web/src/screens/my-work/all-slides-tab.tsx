import { Trans, useLingui } from "@lingui/react/macro";
import { type MyTask, type SlideRow, useGetMe } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { FilterChip } from "@parfocal/ui/components/filter-chip";
import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@parfocal/ui/components/table";
import { StatusTag } from "@parfocal/ui/components/tag";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatDue } from "../format.ts";
import { personProp, usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useSlideProgress } from "../slide-progress.ts";
import { slideOpenPath } from "./list-keys.ts";
import {
  PreviewPanel,
  RowThumb,
  SetChip,
  scopeWords,
  ThreadsValue,
  useOpenThreads,
  useSetLook,
} from "./parts.tsx";
import {
  activeFilterCount,
  filterChoices,
  noSlideFilters,
  type SlideFilterValues,
  statusChoices,
  storageChoices,
  withFilter,
} from "./slide-filters.ts";

const reviewWords: Record<string, { word: string; tone: string }> = {
  "in-review": { word: "in review", tone: "text-accent" },
  submitted: { word: "submitted", tone: "text-ok" },
  assigned: { word: "assigned", tone: "text-fg-faint" },
};

function statusOf(row: SlideRow) {
  if (row.result_sets.length === 0)
    return (
      <StatusTag tone="warn">
        <Trans>needs results</Trans>
      </StatusTag>
    );
  if (row.reviews.length > 0)
    return (
      <StatusTag tone="accent">
        <Trans>in review</Trans>
      </StatusTag>
    );
  return (
    <StatusTag>
      <Trans>ready</Trans>
    </StatusTag>
  );
}

function SlidePreview({
  row,
  tasks,
  onClose,
}: {
  row: SlideRow;
  tasks: MyTask[];
  onClose: () => void;
}) {
  const { t } = useLingui();

  const goTo = useGoTo();
  const people = usePeople();
  const look = useSetLook(row.project.id);
  const me = okData(useGetMe().data);
  const mine = row.reviews.find((review) => review.user_id === me?.user_id);
  const task = tasks.find((candidate) => candidate.id === mine?.task_id);
  const reviewing = mine?.state === "in-review";
  const progress = useSlideProgress(mine ? mine.task_id : undefined, mine ? row.id : undefined);
  const threads = useOpenThreads(row.id);
  const open = () => void goTo(destinations.slide(row.project.id, row.id, mine?.task_id));
  const taskFacts = task
    ? [
        { icon: "users" as const, label: t`Task`, value: `${task.code} · ${task.name}` },
        ...(task.due_on
          ? [{ icon: "calendar" as const, label: "Due", value: formatDue(task.due_on) }]
          : []),
        { icon: "target" as const, label: t`To check`, value: scopeWords[task.scope] },
      ]
    : [
        {
          icon: "user" as const,
          label: t`Reviews`,
          value:
            row.reviews.length > 0
              ? row.reviews
                  .map(
                    (review) =>
                      `${people(review.user_id)?.name ?? t`Reviewer`}, ${reviewWords[review.state]?.word ?? review.state}`,
                  )
                  .join(", ")
              : t`Not in a review task`,
        },
        {
          icon: "layers" as const,
          label: t`Result sets`,
          value:
            row.result_sets.length > 0
              ? row.result_sets.map((set) => look(set).label).join(", ")
              : t`None yet`,
        },
      ];
  return (
    <PreviewPanel
      slideId={row.id}
      title={row.label}
      subtitle={row.project.name}
      progress={mine ? progress : undefined}
      facts={[
        ...taskFacts,
        {
          icon: "file",
          label: row.case_label ? t`Case` : t`Where`,
          value: row.case_label ?? t`${row.project.code}, a loose slide`,
        },
        {
          icon: "comment",
          label: t`Open comments`,
          value: <ThreadsValue anchors={threads.map((thread) => thread.anchor)} />,
        },
      ]}
      main={
        reviewing && mine
          ? {
              label: t`Continue in guided review`,
              run: () => void goTo(destinations.guided(mine.task_id, row.id)),
            }
          : {
              label: t`Open`,
              run: () => void goTo(destinations.openSlide(row.project.id, row.id, mine?.task_id)),
            }
      }
      full={reviewing ? open : undefined}
      onClose={onClose}
    />
  );
}

type Look = ReturnType<typeof useSetLook>;

const rowEstimate = 45;

function scrollParentOf(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

function SlideLine({
  row,
  index,
  on,
  showProject,
  look,
  measure,
  onSelect,
  onOpen,
}: {
  row: SlideRow;
  index: number;
  on: boolean;
  showProject: boolean;
  look: Look;
  measure: (element: HTMLTableRowElement | null) => void;
  onSelect: (key: string) => void;
  onOpen: (row: SlideRow) => void;
}) {
  const { t } = useLingui();

  const people = usePeople();
  return (
    <TableRow
      ref={measure}
      data-index={index}
      aria-rowindex={index + 2}
      aria-selected={on}
      data-vt-source=""
      onClick={() => onSelect(row.id)}
      onDoubleClick={() => onOpen(row)}
      className="cursor-pointer"
    >
      <TableCell className="whitespace-normal">
        <span className="inline-flex items-center gap-2.25">
          <RowThumb slideId={row.id} file={row.label} className="h-5.5 w-8.5" />
          <b className="font-medium text-fg">{row.label}</b>
        </span>
      </TableCell>
      {showProject ? (
        <TableCell className="whitespace-normal">
          {row.project.code} · {row.case_label ? t`case ${row.case_label}` : t`loose`}
        </TableCell>
      ) : null}
      <TableCell className="whitespace-normal">
        <span className="flex flex-wrap gap-1">
          {row.result_sets.length > 0 ? (
            row.result_sets.map((set) => {
              const chip = look(set);
              return <SetChip key={set.id} label={chip.label} source={chip.source} />;
            })
          ) : (
            <span className="text-fg-dim">
              <Trans>none</Trans>
            </span>
          )}
        </span>
      </TableCell>
      <TableCell className="whitespace-normal">
        {row.reviews.length > 0 ? (
          row.reviews.map((review) => (
            <span key={`${review.task_id}-${review.user_id}`} className="my-0.75 flex">
              <Person
                {...personProp(people(review.user_id))}
                size={22}
                sub={reviewWords[review.state]?.word ?? review.state}
              />
            </span>
          ))
        ) : (
          <span className="text-fg-dim">
            <Trans>not assigned</Trans>
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-normal">{statusOf(row)}</TableCell>
    </TableRow>
  );
}

function SlideTable({
  rows,
  selected,
  showProject,
  look,
  onSelect,
  onOpen,
}: {
  rows: SlideRow[];
  selected: string | undefined;
  showProject: boolean;
  look: Look;
  onSelect: (key: string) => void;
  onOpen: (row: SlideRow) => void;
}) {
  const { t } = useLingui();

  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const parent = scrollParentOf(body);
    if (parent !== scroller) setScroller(parent);
    if (!body || !parent) return;
    const offset =
      body.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop;
    if (Math.abs(offset - margin) > 0.5) setMargin(offset);
  });
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => rowEstimate,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 10,
    scrollMargin: margin,
  });
  const selectedIndex = selected === undefined ? -1 : rows.findIndex((row) => row.id === selected);
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);
  const items = virtualizer.getVirtualItems();
  const before = (items[0]?.start ?? margin) - margin;
  const after = virtualizer.getTotalSize() - ((items.at(-1)?.end ?? margin) - margin);
  const headings = [
    t`Slide`,
    ...(showProject ? [t`Project`] : []),
    t`Result sets`,
    t`Reviews`,
    t`Status`,
  ];
  return (
    <Table
      aria-label={t`All slides`}
      aria-rowcount={rows.length + 1}
      containerClassName="overflow-visible"
    >
      <TableHeader>
        <TableRow aria-rowindex={1}>
          {headings.map((heading) => (
            <TableHead key={heading}>{heading}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody ref={bodyRef}>
        {before > 0 ? (
          <tr data-slot="spacer" style={{ height: before }}>
            <td colSpan={headings.length} className="p-0" />
          </tr>
        ) : null}
        {items.map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <SlideLine
              key={row.id}
              row={row}
              index={item.index}
              on={row.id === selected}
              showProject={showProject}
              look={look}
              measure={virtualizer.measureElement}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          );
        })}
        {after > 0 ? (
          <tr data-slot="spacer" style={{ height: after }}>
            <td colSpan={headings.length} className="p-0" />
          </tr>
        ) : null}
      </TableBody>
    </Table>
  );
}

export function AllSlidesTab({
  rows,
  everyRow,
  tasks,
  query,
  onQuery,
  filters,
  onFilters,
  selected,
  onSelect,
}: {
  rows: SlideRow[];
  everyRow: SlideRow[];
  tasks: MyTask[];
  query: string;
  onQuery: (query: string) => void;
  filters: SlideFilterValues;
  onFilters: (filters: SlideFilterValues) => void;
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
}) {
  const { t } = useLingui();

  const people = usePeople();
  const goTo = useGoTo();
  const me = okData(useGetMe().data);
  const look = useSetLook(rows[0]?.project.id);
  const preview = rows.find((row) => row.id === selected);
  const choices = filterChoices(everyRow, (userId) => people(userId)?.name ?? t`Reviewer`);
  const active = activeFilterCount(filters);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label className="flex h-7.5 w-65 items-center gap-2 rounded-lg border border-line-strong px-2.5 text-body-sm text-fg-faint focus-within:border-accent">
          <Icon name="search" />
          <input
            aria-label={t`Find a slide, case or ID`}
            placeholder={t`Find a slide, case or ID`}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-fg-faint"
          />
        </label>
        <FilterChip
          label={t`Project`}
          anyLabel="all"
          options={choices.projects}
          value={filters.project}
          onValueChange={(value) => onFilters(withFilter(filters, "project", value))}
        />
        <FilterChip
          label={t`Status`}
          options={statusChoices}
          value={filters.status}
          onValueChange={(value) =>
            onFilters(
              withFilter(
                filters,
                "status",
                statusChoices.find((choice) => choice.value === value)?.value,
              ),
            )
          }
        />
        <FilterChip
          label={t`Result set`}
          options={choices.sets}
          value={filters.set}
          onValueChange={(value) => onFilters(withFilter(filters, "set", value))}
        />
        <FilterChip
          label={t`Reviewer`}
          options={choices.reviewers}
          value={filters.reviewer}
          onValueChange={(value) => onFilters(withFilter(filters, "reviewer", value))}
        />
        <FilterChip
          label={t`Storage`}
          options={storageChoices}
          value={filters.storage}
          onValueChange={(value) =>
            onFilters(
              withFilter(
                filters,
                "storage",
                storageChoices.find((choice) => choice.value === value)?.value,
              ),
            )
          }
        />
        {active > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => onFilters(noSlideFilters)}>
            <Trans>Clear filters</Trans>
          </Button>
        ) : null}
      </div>
      <div
        className={`mt-1 grid items-start gap-5 ${preview ? "grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-[minmax(0,1fr)]"}`}
      >
        <SlideTable
          rows={rows}
          selected={selected}
          showProject={!preview}
          look={look}
          onSelect={onSelect}
          onOpen={(row) => void goTo(slideOpenPath(row, me?.user_id))}
        />
        {rows.length === 0 ? (
          <p className="m-0 py-6 text-center text-body-sm text-fg-dim">
            {active > 0 || query ? t`No slide matches these filters.` : t`No slides yet.`}
          </p>
        ) : null}
        {preview ? (
          <SlidePreview row={preview} tasks={tasks} onClose={() => onSelect(undefined)} />
        ) : null}
      </div>
    </div>
  );
}
