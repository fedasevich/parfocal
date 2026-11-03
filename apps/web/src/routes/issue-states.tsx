import { Button } from "@parfocal/ui/components/button";
import { cn } from "@parfocal/ui/lib/utils";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { isScreenBuilt, type PrototypeScreen, pendingTask } from "../flow-map/built-screens.ts";
import { originStore, useScenarioIds } from "../flow-map/hooks.ts";
import {
  type IssueRow,
  issueGroups,
  issueStateCount,
  issueStatesTitle,
  issueTarget,
  issueWho,
} from "../flow-map/issue-states.ts";
import type { ScenarioIds } from "../flow-map/targets.ts";

export const Route = createFileRoute("/issue-states")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: IssueStatesPage,
});

const screenTitles: Record<PrototypeScreen, string> = {
  home: "Home",
  project: "Project",
  upload: "Upload",
  runmodel: "Run a model",
  task: "New review task",
  team: "Team",
  disagree: "Disagreements",
  signoff: "Sign off the evaluation",
  evaluation: "Evaluation report",
  worklist: "My work",
  guided: "Guided review",
  case: "Full viewer",
  gallery: "Decide objects",
  next: "Submitted",
  creport: "Clinical report",
  cosign: "Co-sign review",
  settings: "Settings",
  signin: "Sign in",
  connectmodel: "Connect a model",
  layers: "Display",
  navigator: "Smart minimap",
  measure: "Measuring",
  annotate: "Annotate workspace",
  compare: "Compare slides",
  focus: "Focus mode",
  peek: "Whole-slide peek",
};

function StateButton({
  screen,
  scene,
  ids,
  children,
}: {
  screen: PrototypeScreen;
  scene: string;
  ids: ScenarioIds | undefined;
  children: string;
}) {
  const target = ids && isScreenBuilt(screen) ? issueTarget(screen, scene, ids) : null;
  if (target === null) {
    const waiting = pendingTask[screen];
    return (
      <Button
        size="sm"
        disabled
        focusableWhenDisabled
        data-state-button={`${screen}:${scene}`}
        title={waiting ? `Not built yet, ${waiting} builds it` : "Not built yet"}
      >
        {children}
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      nativeButton={false}
      data-state-button={`${screen}:${scene}`}
      title={`Opens ${screenTitles[screen]} in this state`}
      render={
        <Link
          {...target}
          onClick={() => originStore.set({ kind: "states", who: issueWho(screen) })}
        />
      }
    >
      {children}
    </Button>
  );
}

function StateRow({ row, ids }: { row: IssueRow; ids: ScenarioIds | undefined }) {
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-line border-t py-2 first-of-type:border-t-0"
      data-issue-state={`${row.screen}:${row.scene}`}
    >
      <span className="inline-flex items-center gap-[7px] font-semibold text-body-sm text-fg">
        <i
          aria-hidden="true"
          className={cn("size-[7px] flex-none rounded-full", row.plain ? "bg-ok" : "bg-warn")}
        />
        {row.label}
      </span>
      <small className="col-start-1 pl-3.5 text-body-sm text-fg-dim leading-[18px]">
        {row.detail}
      </small>
      <span className="col-start-2 row-span-2 row-start-1 inline-flex gap-1.5">
        <StateButton screen={row.screen} scene={row.scene} ids={ids}>
          {row.also ? "Guided" : "Show"}
        </StateButton>
        {row.also ? (
          <StateButton screen={row.also} scene={row.scene} ids={ids}>
            {row.also === "layers" ? "Display" : "Full viewer"}
          </StateButton>
        ) : null}
      </span>
    </div>
  );
}

function IssueStatesPage() {
  const ids = useScenarioIds();
  useEffect(() => originStore.set(null), []);
  return (
    <main className="min-h-screen bg-page px-6 pt-[18px] pb-8">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h1 className="m-0 font-semibold text-page-title text-fg leading-7">
            {issueStatesTitle}
          </h1>
          <p className="mt-1.5 mb-[18px] max-w-[860px] text-body text-fg-dim leading-5">
            {issueStateCount} states, grouped by flow. Each one is a scene of its own screen, and
            Show opens that screen in that state with its fix ready to try. Back to the index sits
            above the frame.
          </p>
        </div>
        <Link to="/prototype" className="text-caption text-fg-faint underline">
          Prototype index
        </Link>
      </header>
      <div className="gap-5 md:columns-2" data-testid="issue-states">
        {issueGroups.map((group) => (
          <section
            key={group.flow}
            aria-label={group.flow}
            className="mb-5 break-inside-avoid rounded-zone border border-line bg-surf-section px-3.5 pt-3 pb-1.5"
          >
            <h2 className="m-0 mb-1.5 font-semibold text-body text-fg leading-5">{group.flow}</h2>
            {group.rows.map((row) => (
              <StateRow key={`${row.screen}:${row.scene}`} row={row} ids={ids} />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
