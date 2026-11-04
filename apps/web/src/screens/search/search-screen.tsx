import { type SearchHit, useListProjects, useSearch } from "@parfocal/api-client";
import { Icon } from "@parfocal/ui/components/icon";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { type ReactNode, useEffect, useState } from "react";
import { setDeveloperMode, useDeveloperMode } from "../../shell/developer-mode.ts";
import { useOverlay } from "../../shell/overlays.ts";
import { matchCommand } from "../../shell/palette-match.ts";
import { useGoTo } from "../../shell/router-link.tsx";
import {
  hitGroups,
  hitHref,
  hitIcons,
  type SearchPageScope,
  searchScopes,
} from "../../shell/search-hits.ts";
import { plural } from "../format.ts";
import { okData } from "../placeholder.tsx";

type PaletteEntries = typeof import("../../shell/palette-commands.ts")["paletteEntries"];

function useActionSource(): PaletteEntries | undefined {
  const [source, setSource] = useState<PaletteEntries>();
  useEffect(() => {
    void import("../../shell/palette-commands.ts").then((module) =>
      setSource(() => module.paletteEntries),
    );
  }, []);
  return source;
}

type SearchState = { q: string; scope: SearchPageScope };

const rowClass =
  "grid w-full grid-cols-[22px_1fr_auto] items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-body text-fg enabled:cursor-pointer enabled:hover:bg-accent-soft";

function hitDetail(hit: SearchHit): string {
  if (hit.kind === "project" || hit.kind === "person") return "";
  return [hit.project?.code, hit.case_label].filter(Boolean).join(" · ");
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-px">
      <h2 className="m-0 px-2.5 pt-1.5 pb-1 text-caption font-semibold text-fg-dim">
        {title} <span className="font-normal">{count}</span>
      </h2>
      {children}
    </section>
  );
}

export function SearchScreen({
  state,
  change,
}: {
  state: SearchState;
  change: (next: Partial<SearchState>) => void;
}) {
  const goTo = useGoTo();
  const overlay = useOverlay();
  const [draft, setDraft] = useState(state.q);
  const developerMode = useDeveloperMode();
  const paletteEntries = useActionSource();
  const projects = okData(useListProjects().data) ?? [];
  const trimmed = state.q.trim();
  const ready = trimmed.length >= 2;
  const onlyActions = state.scope === "actions";
  const found = useSearch(
    { q: trimmed, scope: state.scope === "actions" ? "all" : state.scope },
    { query: { enabled: ready && !onlyActions } },
  );
  const hits = ready && !onlyActions ? (okData(found.data)?.hits ?? []) : [];
  const actions =
    ready && paletteEntries && (onlyActions || state.scope === "all")
      ? paletteEntries({
          projectId: projects[0]?.id ?? "",
          onSlide: false,
          developerMode,
          go: (href) => void goTo(href),
          measure: () => {},
          openNotifications: () => void overlay.set("notifications"),
          setDeveloperMode,
        }).flatMap((entry) => {
          if (entry.group !== "Actions") return [];
          const match = matchCommand(entry.label, entry.keywords, trimmed);
          return match === null ? [] : [{ entry, score: match.score }];
        })
      : [];
  const sortedActions = actions.sort((a, b) => b.score - a.score).map(({ entry }) => entry);
  const groups = hitGroups
    .map((group) => ({
      title: group.title,
      hits: hits.filter((hit) => (group.kinds as readonly string[]).includes(hit.kind)),
    }))
    .filter((group) => group.hits.length > 0);
  const total = groups.reduce((sum, group) => sum + group.hits.length, 0) + sortedActions.length;
  return (
    <main className="flex min-h-0 flex-col gap-(--density-flow-gap) overflow-auto px-8 pt-5.5 pb-4.5 pl-7">
      <header>
        <h1 className="m-0 text-page-title font-semibold tracking-[-0.01em] text-fg">Search</h1>
        <p className="mt-0.75 mb-0 text-body-sm leading-[1.45] text-fg-dim">
          Projects, cases, slides, object IDs like T2·C145, people and actions
        </p>
      </header>
      <search className="flex max-w-[640px] items-center gap-2.5 rounded-lg border border-line-strong bg-chrome px-3.5 py-2.5 text-lead focus-within:border-accent">
        <Icon name="search" className="text-fg-dim" />
        <input
          aria-label="Search everything"
          className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-fg-faint"
          placeholder="Search slides, cases, IDs like T2·C145 and people"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            change({ q: event.target.value });
          }}
        />
      </search>
      <SegmentedControl
        aria-label="Search scope"
        wrap
        value={state.scope}
        onValueChange={(value) => change({ scope: value as SearchPageScope })}
        options={searchScopes.map((scope) => ({ value: scope.value, label: scope.label }))}
      />
      <div aria-live="polite" className="grid max-w-[760px] gap-2">
        {!ready ? (
          <p className="m-0 text-body-sm text-fg-dim">Type at least two letters to search.</p>
        ) : found.isPending && !onlyActions ? (
          <p className="m-0 text-body-sm text-fg-dim">Searching…</p>
        ) : total === 0 ? (
          <p className="m-0 text-body-sm text-fg-dim">Nothing matches "{trimmed}".</p>
        ) : (
          <p className="m-0 text-body-sm text-fg-dim">{plural(total, "result")}</p>
        )}
        {groups.map((group) => (
          <Group key={group.title} title={group.title} count={group.hits.length}>
            {group.hits.map((hit) => {
              const href = hitHref(hit);
              return (
                <button
                  key={`${hit.kind}-${hit.id}`}
                  type="button"
                  disabled={href === null}
                  className={rowClass}
                  onClick={() => (href === null ? undefined : void goTo(href))}
                >
                  <Icon name={hitIcons[hit.kind]} />
                  <span>{hit.label}</span>
                  <span className="text-body-sm text-fg-dim">{hitDetail(hit)}</span>
                </button>
              );
            })}
          </Group>
        ))}
        {sortedActions.length > 0 ? (
          <Group title="Actions" count={sortedActions.length}>
            {sortedActions.map((entry) => (
              <button key={entry.id} type="button" className={rowClass} onClick={entry.run}>
                <Icon name={entry.icon} />
                <span>{entry.label}</span>
                <span className="text-body-sm text-fg-dim">{entry.keys ?? ""}</span>
              </button>
            ))}
          </Group>
        ) : null}
      </div>
    </main>
  );
}
