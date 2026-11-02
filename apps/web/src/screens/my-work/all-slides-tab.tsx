import { type MyTask, type SlideRow, useGetMe } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Person } from "@parfocal/ui/components/person";
import { StatusTag } from "@parfocal/ui/components/tag";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatDue } from "../format.ts";
import { personProp, usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useSlideProgress } from "../slide-progress.ts";
import {
  PreviewPanel,
  SetChip,
  SlideThumb,
  scopeWords,
  ThreadsValue,
  useOpenThreads,
  useSetLook,
} from "./parts.tsx";

const reviewWords: Record<string, { word: string; tone: string }> = {
  "in-review": { word: "in review", tone: "text-accent" },
  submitted: { word: "submitted", tone: "text-ok" },
  assigned: { word: "assigned", tone: "text-fg-faint" },
};

function statusOf(row: SlideRow) {
  if (row.result_sets.length === 0) return <StatusTag tone="warn">needs results</StatusTag>;
  if (row.reviews.length > 0) return <StatusTag tone="accent">in review</StatusTag>;
  return <StatusTag>ready</StatusTag>;
}

const filters = ["Project: all", "Status: any", "Has results", "Reviewer: any", "Remote"];

function SlidePreview({
  row,
  tasks,
  onClose,
}: {
  row: SlideRow;
  tasks: MyTask[];
  onClose: () => void;
}) {
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
        { icon: "users" as const, label: "Task", value: `${task.code} · ${task.name}` },
        ...(task.due_on
          ? [{ icon: "calendar" as const, label: "Due", value: formatDue(task.due_on) }]
          : []),
        { icon: "target" as const, label: "To check", value: scopeWords[task.scope] },
      ]
    : [
        {
          icon: "user" as const,
          label: "Reviews",
          value:
            row.reviews.length > 0
              ? row.reviews
                  .map(
                    (review) =>
                      `${people(review.user_id)?.name ?? "Reviewer"}, ${reviewWords[review.state]?.word ?? review.state}`,
                  )
                  .join(", ")
              : "Not in a review task",
        },
        {
          icon: "layers" as const,
          label: "Result sets",
          value:
            row.result_sets.length > 0
              ? row.result_sets.map((set) => look(set).label).join(", ")
              : "None yet",
        },
      ];
  return (
    <PreviewPanel
      title={row.label}
      subtitle={row.project.name}
      progress={mine ? progress : undefined}
      facts={[
        ...taskFacts,
        {
          icon: "file",
          label: row.case_label ? "Case" : "Where",
          value: row.case_label ?? `${row.project.code}, a loose slide`,
        },
        {
          icon: "comment",
          label: "Open comments",
          value: <ThreadsValue anchors={threads.map((thread) => thread.anchor)} />,
        },
      ]}
      main={
        reviewing && mine
          ? {
              label: "Continue in guided review",
              run: () => void goTo(destinations.guided(mine.task_id, row.id)),
            }
          : {
              label: "Open",
              run: () => void goTo(destinations.openSlide(row.project.id, row.id, mine?.task_id)),
            }
      }
      full={reviewing ? open : undefined}
      onClose={onClose}
    />
  );
}

export function AllSlidesTab({
  rows,
  tasks,
  query,
  onQuery,
  selected,
  onSelect,
}: {
  rows: SlideRow[];
  tasks: MyTask[];
  query: string;
  onQuery: (query: string) => void;
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
}) {
  const people = usePeople();
  const look = useSetLook(rows[0]?.project.id);
  const preview = rows.find((row) => row.id === selected);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label className="flex h-7.5 w-65 items-center gap-2 rounded-lg border border-line-strong px-2.5 text-body-sm text-fg-faint">
          <Icon name="search" />
          <input
            aria-label="Find a slide, case or ID"
            placeholder="Find a slide, case or ID"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-fg-faint"
          />
        </label>
        {filters.map((filter) => (
          <Button key={filter} size="sm">
            {filter}
            <Icon name="down" />
          </Button>
        ))}
      </div>
      <div
        className={`mt-1 grid items-start gap-5 ${preview ? "grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-[minmax(0,1fr)]"}`}
      >
        <table className="w-full border-collapse text-body-sm">
          <thead>
            <tr className="text-left text-caption text-fg-dim">
              {["Slide", ...(preview ? [] : ["Project"]), "Result sets", "Reviews", "Status"].map(
                (heading) => (
                  <th
                    key={heading}
                    className="whitespace-nowrap border-line-strong border-b px-2 py-1.75 font-semibold"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const on = row.id === selected;
              return (
                <tr
                  key={row.id}
                  aria-selected={on}
                  onClick={() => onSelect(row.id)}
                  className={`cursor-pointer border-line border-b ${on ? "bg-accent-soft" : ""}`}
                >
                  <td className="px-2 py-2 align-middle">
                    <span className="inline-flex items-center gap-2.25">
                      <SlideThumb className="h-5.5 w-8.5" />
                      <b className="font-medium text-fg">{row.label}</b>
                    </span>
                  </td>
                  {preview ? null : (
                    <td className="px-2 py-2 align-middle text-fg-dim">
                      {row.project.code} · {row.case_label ? `case ${row.case_label}` : "loose"}
                    </td>
                  )}
                  <td className="px-2 py-2 align-middle">
                    <span className="flex flex-wrap gap-1">
                      {row.result_sets.length > 0 ? (
                        row.result_sets.map((set) => {
                          const chip = look(set);
                          return <SetChip key={set.id} label={chip.label} source={chip.source} />;
                        })
                      ) : (
                        <span className="text-fg-dim">none</span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2 align-middle">
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
                      <span className="text-fg-dim">not assigned</span>
                    )}
                  </td>
                  <td className="px-2 py-2 align-middle">{statusOf(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {preview ? (
          <SlidePreview row={preview} tasks={tasks} onClose={() => onSelect(undefined)} />
        ) : null}
      </div>
    </div>
  );
}
