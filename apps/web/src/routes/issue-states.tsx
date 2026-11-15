import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { lazyText } from "@parfocal/ui/lib/lazy-text";
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

const screenTitles: Record<PrototypeScreen, string> = lazyText(() => ({
  home: t`Home`,
  project: t`Project`,
  upload: t`Upload`,
  runmodel: t`Run a model`,
  task: t`New review task`,
  team: t`Team`,
  disagree: t`Disagreements`,
  signoff: t`Sign off the evaluation`,
  evaluation: t`Evaluation report`,
  worklist: t`My work`,
  guided: t`Guided review`,
  case: t`Full viewer`,
  gallery: t`Decide objects`,
  next: t`Submitted`,
  creport: t`Clinical report`,
  cosign: "Co-sign review",
  settings: t`Settings`,
  signin: t`Sign in`,
  connectmodel: t`Connect a model`,
  layers: t`Display`,
  navigator: t`Smart minimap`,
  measure: t`Measuring`,
  annotate: t`Annotate workspace`,
  compare: t`Compare slides`,
  focus: t`Focus mode`,
  peek: "Whole-slide peek",
}));

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
  const { t } = useLingui();

  const target = ids && isScreenBuilt(screen) ? issueTarget(screen, scene, ids) : null;
  if (target === null) {
    const waiting = pendingTask[screen];
    return (
      <Button
        size="sm"
        disabled
        focusableWhenDisabled
        data-state-button={`${screen}:${scene}`}
        title={waiting ? t`Not built yet, ${waiting} builds it` : t`Not built yet`}
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
      title={t`Opens ${screenTitles[screen]} in this state`}
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
  const { t } = useLingui();

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
          {row.also ? t`Guided` : t`Show`}
        </StateButton>
        {row.also ? (
          <StateButton screen={row.also} scene={row.scene} ids={ids}>
            {row.also === "layers" ? t`Display` : t`Full viewer`}
          </StateButton>
        ) : null}
      </span>
    </div>
  );
}

const sharedPages = [
  { kind: "not-found", label: msg`Page not found` },
  { kind: "server-error", label: msg`Something went wrong` },
  { kind: "expired", label: msg`Session expired` },
  { kind: "no-access", label: msg`No access` },
  { kind: "styles", label: msg`Banner and inline error styles` },
] as const;

function SharedPages() {
  const { t } = useLingui();

  return (
    <section
      aria-label={t`Shared pages`}
      className="mb-5 break-inside-avoid rounded-zone border border-line bg-surf-section px-3.5 pt-3 pb-3"
    >
      <h2 className="m-0 mb-1.5 font-semibold text-body text-fg leading-5">
        <Trans>Shared pages</Trans>
      </h2>
      <p className="m-0 mb-2 text-body-sm text-fg-dim leading-[18px]">
        <Trans>The pages every flow falls back to, shown on their own.</Trans>
      </p>
      <span className="inline-flex flex-wrap gap-1.5">
        {sharedPages.map((page) => (
          <Button
            key={page.kind}
            size="sm"
            nativeButton={false}
            data-page-link={page.kind}
            render={<Link to="/issue-pages/$kind" params={{ kind: page.kind }} />}
          >
            {t(page.label)}
          </Button>
        ))}
      </span>
    </section>
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
            <Trans>
              {issueStateCount} states, grouped by flow. Each one is a scene of its own screen, and
              Show opens that screen in that state with its fix ready to try. Back to the index sits
              above the frame.
            </Trans>
          </p>
        </div>
        <Link to="/prototype" className="text-caption text-fg-faint underline">
          <Trans>Prototype index</Trans>
        </Link>
      </header>
      <div className="gap-5 md:columns-2" data-testid="issue-states">
        <SharedPages />
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
