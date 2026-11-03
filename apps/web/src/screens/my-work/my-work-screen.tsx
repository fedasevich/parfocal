import {
  useGetMe,
  useListMyAdjudications,
  useListMyReviewTasks,
  useListMySlides,
  useListTasksAssignedByMe,
} from "@parfocal/api-client";
import { TabCount, Tabs, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import { useEffect } from "react";
import { now } from "../../clock.ts";
import { destinations } from "../../shell/destinations.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import { formatLongDay, plural } from "../format.ts";
import { okData } from "../placeholder.tsx";
import { AllSlidesTab } from "./all-slides-tab.tsx";
import { AssignedTab } from "./assigned-tab.tsx";
import { assignedOpenPath, ignoresListKeys, listMove, slideOpenPath } from "./list-keys.ts";
import type { MyWorkState, MyWorkTab } from "./scenes.ts";
import { slideQuery } from "./slide-filters.ts";
import { activeTasks, adjudicationKey, ToReviewTab } from "./to-review-tab.tsx";

type Change = Partial<Omit<MyWorkState, "q" | "filters">> & {
  q?: string | undefined;
  filters?: MyWorkState["filters"];
};

export function MyWorkScreen({
  state,
  change,
}: {
  state: MyWorkState;
  change: (next: Change) => void;
}) {
  const goTo = useGoTo();
  const tasks = okData(useListMyReviewTasks().data) ?? [];
  const adjudications = useListMyAdjudications().data?.data ?? [];
  const assigned = okData(useListTasksAssignedByMe().data) ?? [];
  const slides = okData(useListMySlides(slideQuery(state.filters, state.q)).data)?.slides ?? [];
  const me = okData(useGetMe().data);
  const everySlide = okData(useListMySlides().data)?.slides ?? [];
  const active = activeTasks(tasks);
  const toReview = active.length + adjudications.length;
  const reviewRows = [
    ...adjudications.map((item) => ({
      key: adjudicationKey(item),
      path: destinations.disagreements(item.task_id, "adjudicate"),
    })),
    ...active.map((task) => ({
      key: task.id,
      path: destinations.guided(task.id, task.next_slide_id),
    })),
  ];
  const rows =
    state.tab === "all"
      ? slides.map((row) => ({ key: row.id, path: slideOpenPath(row, me?.user_id) }))
      : state.tab === "assigned"
        ? assigned.map((task) => ({ key: task.id, path: assignedOpenPath(task) }))
        : reviewRows;
  const rowKeys = rows.map((row) => row.key);
  const firstKey = rowKeys[0];
  const wantsPreview = state.scene === "preview" || state.scene === "allpreview";
  useEffect(() => {
    if (wantsPreview && state.sel === undefined && firstKey !== undefined) {
      change({ sel: firstKey });
    }
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || ignoresListKeys(event.target, event.key)) return;
      const move = listMove(event, rowKeys, state.sel);
      if (move === undefined) return;
      event.preventDefault();
      if (move.kind === "clear") change({ sel: undefined });
      if (move.kind === "select") change({ sel: move.sel });
      if (move.kind === "open") {
        const row = rows.find((candidate) => candidate.key === state.sel);
        if (row) void goTo(row.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (state.sel === undefined) return;
    document
      .querySelector("main [aria-selected='true']:not([role='tab'])")
      ?.scrollIntoView({ block: "nearest" });
  }, [state.sel]);
  const today = formatLongDay(now());
  const waiting = assigned.filter(
    (task) => task.status === "disagreements" || task.status === "ready-to-sign-off",
  ).length;
  const toDecide = adjudications.reduce((sum, item) => sum + item.objects.length - item.decided, 0);
  const subtitle =
    state.tab === "assigned"
      ? `${today} · ${plural(assigned.length, "task")} you assigned${waiting ? ` · ${waiting} waiting for you to resolve` : ""}`
      : `${today} · ${plural(active.length, "task")} to review${toDecide ? ` · ${plural(toDecide, "object")} to decide` : ""}`;
  const tabLabel = (label: string, count: number) => (
    <>
      {label}
      <TabCount>{count}</TabCount>
    </>
  );
  return (
    <main className="flex min-h-0 flex-col gap-4 px-8 pt-5.5 pb-4.5 pl-7">
      <header>
        <h1 className="m-0 text-[24px] font-semibold tracking-[-0.01em] text-fg">My work</h1>
        <p className="mt-0.75 mb-0 text-body-sm leading-[1.45] text-fg-dim">{subtitle}</p>
      </header>
      <Tabs
        value={state.tab}
        onValueChange={(value) =>
          change({
            tab: value as MyWorkTab,
            sel: undefined,
            scene: value === "review" && state.scene === "anna" ? "anna" : undefined,
          })
        }
      >
        <TabsList variant="page">
          <TabsTrigger value="review">{tabLabel("To review", toReview)}</TabsTrigger>
          <TabsTrigger value="assigned">{tabLabel("Assigned by me", assigned.length)}</TabsTrigger>
          <TabsTrigger value="all">{tabLabel("All slides", slides.length)}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex min-h-0 flex-col gap-3">
        {state.tab === "review" ? (
          <ToReviewTab
            tasks={tasks}
            adjudications={adjudications}
            selected={state.sel}
            onSelect={(sel) => change({ sel })}
          />
        ) : null}
        {state.tab === "assigned" ? (
          <AssignedTab tasks={assigned} selected={state.sel} onSelect={(sel) => change({ sel })} />
        ) : null}
        {state.tab === "all" ? (
          <AllSlidesTab
            rows={slides}
            everyRow={everySlide}
            tasks={tasks}
            filters={state.filters}
            onFilters={(filters) => change({ filters, sel: undefined })}
            query={state.q}
            onQuery={(q) => change({ q: q || undefined })}
            selected={state.sel}
            onSelect={(sel) => change({ sel })}
          />
        ) : null}
      </div>
    </main>
  );
}
