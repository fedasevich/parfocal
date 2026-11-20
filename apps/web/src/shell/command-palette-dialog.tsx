import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { type SearchHit, useListProjects, useSearch } from "@parfocal/api-client";
import { CommandPaletteView, type PaletteCommand } from "@parfocal/ui/components/command-palette";
import { Dialog, DialogContent, DialogTitle } from "@parfocal/ui/components/dialog";
import { useParams, useRouter, useRouterState } from "@tanstack/react-router";
import { type KeyboardEvent, useState } from "react";
import { useHintsSeen } from "../hints/hints-seen.ts";
import { isSlidePath, openDeveloperDrawer } from "../lab/developer-drawer-state.ts";
import { useDeveloperAllowed } from "../lab/use-developer-allowed.ts";
import { okData } from "../screens/placeholder.tsx";
import { destinations } from "./destinations.ts";
import { setDeveloperMode, useDeveloperMode } from "./developer-mode.ts";
import { useOverlay } from "./overlays.ts";
import { type PaletteGroup, paletteEntries, paletteGroups } from "./palette-commands.ts";
import { usePaletteLabels } from "./palette-labels.tsx";
import { matchCommand, matchText } from "./palette-match.ts";
import { useGoTo } from "./router-link.tsx";
import { searchHandoff } from "./search-handoff.ts";
import { hitHref, hitIcons } from "./search-hits.ts";

type Row = PaletteCommand & { group: PaletteGroup; score: number };

const perGroupLimit = 8;

const objectScore = 100;

function objectLabel(hit: SearchHit): string {
  const object = hit.object_id;
  if (object === null || object === undefined) return hit.label;
  const shown = object.replace(/^(T\d+)\./, "$1\u00b7");
  const at = hit.label.lastIndexOf(` ${object}`);
  const slide = at > 0 ? hit.label.slice(0, at) : null;
  if (slide === null) return hit.label;
  const resolved = hit.resolved_from ? ` (${hit.resolved_from})` : "";
  return `${shown}${resolved} on ${slide}`;
}

function hitRow(hit: SearchHit, query: string, run: () => void): Row {
  if (hit.kind === "object") {
    return {
      id: `hit-${hit.kind}-${hit.id}-${hit.object_id ?? ""}`,
      group: "Go to",
      icon: hitIcons[hit.kind],
      label: objectLabel(hit),
      matched: [],
      score: objectScore,
      run,
    };
  }
  const label =
    hit.project && hit.kind !== "project" ? `${hit.label} · ${hit.project.code}` : hit.label;
  const keywords = [hit.id, hit.case_label ?? "", hit.project?.code ?? ""];
  const found = query ? matchCommand(label, keywords, query) : null;
  return {
    id: `hit-${hit.kind}-${hit.id}`,
    group: "Go to",
    icon: hitIcons[hit.kind],
    label,
    matched: found?.indices ?? [],
    score: found?.score ?? 1,
    run,
  };
}

type OpenSlide = { projectId: string; slideId: string; taskId: string | undefined };

function usePlaces(
  query: string,
  close: () => void,
  open: OpenSlide | null,
): { rows: Row[]; searching: boolean } {
  const goTo = useGoTo();
  const router = useRouter();
  const projects = okData(useListProjects().data) ?? [];
  const search = useSearch(
    {
      q: query,
      ...(open === null
        ? {}
        : {
            project_id: open.projectId,
            slide_id: open.slideId,
            ...(open.taskId === undefined ? {} : { task_id: open.taskId }),
          }),
    },
    { query: { enabled: query.length >= 2 } },
  );
  const hits = okData(search.data)?.hits ?? [];
  if (query.length < 2) return { rows: [], searching: false };
  const searching = search.isFetching;
  const opener = (href: string) => () => {
    close();
    void goTo(href);
  };
  const fromServer = hits.flatMap((hit) => {
    const href = hitHref(hit);
    if (href === null) return [];
    if (hit.kind === "object" && open !== null && hit.slide_id === open.slideId) {
      const stay = () => {
        close();
        void router.navigate({
          to: ".",
          search: ((previous: Record<string, unknown>) => ({
            ...previous,
            object: hit.object_id,
            x: undefined,
            y: undefined,
            z: undefined,
          })) as never,
        });
      };
      return [hitRow(hit, query, stay)];
    }
    return [hitRow(hit, query, opener(href))];
  });
  const known = new Set(fromServer.map((row) => row.id));
  const fromList = projects.flatMap((project) => {
    const hit: SearchHit = {
      kind: "project",
      id: project.id,
      label: `${project.code} · ${project.name}`,
    };
    if (matchText(hit.label, query) === null) return [];
    const row = hitRow(hit, query, opener(destinations.project(project.id)));
    return known.has(row.id) ? [] : [row];
  });
  return { rows: [...fromServer, ...fromList], searching };
}

function PaletteBody({ initial, close }: { initial: string; close: () => void }) {
  const { t } = useLingui();
  const paletteLabels = usePaletteLabels();

  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const goTo = useGoTo();
  const router = useRouter();
  const overlay = useOverlay();
  const params = useParams({ strict: false });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const developerMode = useDeveloperMode();
  const developerAllowed = useDeveloperAllowed();
  const hints = useHintsSeen();
  const projects = okData(useListProjects().data) ?? [];
  const trimmed = query.trim();
  const search = useRouterState({ select: (state) => state.location.search as { task?: unknown } });
  const openSlide: OpenSlide | null =
    params.projectId && params.slideId
      ? {
          projectId: params.projectId,
          slideId: params.slideId,
          taskId: typeof search.task === "string" ? search.task : undefined,
        }
      : null;
  const { rows: places, searching } = usePlaces(trimmed, close, openSlide);
  const entries = paletteEntries({
    projectId: params.projectId ?? projects[0]?.id ?? "",
    onSlide: /^\/projects\/[^/]+\/slides\/[^/]+$/.test(pathname),
    developerMode,
    developerAllowed,
    openDeveloper: (section) => {
      close();
      if (isSlidePath(pathname)) openDeveloperDrawer(section);
      else void goTo(destinations.developer(section));
    },
    go: (href) => {
      close();
      void goTo(href);
    },
    measure: () =>
      void router.navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          tool: "ruler" as const,
          open: undefined,
          find: undefined,
        }),
      }),
    openNotifications: () => void overlay.set("notifications"),
    setDeveloperMode: (on) => {
      setDeveloperMode(on);
      close();
    },
    showAllHints: () => {
      hints.showAllAgain();
      close();
    },
  });
  const translatedEntries = entries.map((entry) => {
    const key =
      entry.id === "setting-developer-mode"
        ? entry.label.endsWith("off")
          ? "setting-developer-mode-off"
          : "setting-developer-mode-on"
        : entry.id;
    return { ...entry, label: paletteLabels[key] ?? entry.label };
  });
  const local = translatedEntries.flatMap((entry): Row[] => {
    if (!trimmed) {
      return entry.group === "Settings" && !entry.featured
        ? []
        : [{ ...entry, matched: [], score: 0 }];
    }
    const found = matchCommand(entry.label, entry.keywords, trimmed);
    return found === null ? [] : [{ ...entry, matched: found.indices, score: found.score }];
  });
  const rows = [...local, ...places];
  const byGroup = paletteGroups.map((group, order) => ({
    group,
    order,
    rows: rows
      .filter((row) => row.group === group)
      .map((row, position) => ({ row, position }))
      .sort((a, b) => b.row.score - a.row.score || a.position - b.position)
      .slice(0, perGroupLimit)
      .map(({ row }) => row),
  }));
  const ranked = byGroup
    .filter((entry) => entry.rows.length > 0)
    .sort((a, b) => (b.rows[0]?.score ?? 0) - (a.rows[0]?.score ?? 0) || a.order - b.order)
    .flatMap((entry) => entry.rows);
  const allResults: Row[] =
    trimmed.length >= 2
      ? [
          {
            id: "all-results",
            group: "Go to",
            icon: "search",
            label: t`All results for "${trimmed}"`,
            matched: [],
            score: 0,
            run: () => {
              close();
              const { href, state } = searchHandoff(trimmed);
              void router.navigate({ href, state: state as never });
            },
          },
        ]
      : [];
  const commands = [...ranked, ...allResults];
  const groupOrder = [...new Set(commands.map((command) => command.group))];
  const current = Math.min(active, Math.max(0, commands.length - 1));
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + commands.length) % Math.max(1, commands.length));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commands[current]?.run();
    }
  };
  return (
    <CommandPaletteView
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        setActive(0);
      }}
      commands={commands}
      groups={groupOrder}
      current={current}
      onCurrentChange={setActive}
      onKeyDown={onKeyDown}
      searching={searching}
    />
  );
}

export default function PaletteDialog() {
  const overlay = useOverlay();
  const close = () => void overlay.set(undefined);
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        showCloseButton={false}
        className="top-[110px] translate-y-0 gap-0 overflow-hidden bg-chrome p-0 sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">
          <Trans>Command palette</Trans>
        </DialogTitle>
        <PaletteBody initial={overlay.find ?? ""} close={close} />
      </DialogContent>
    </Dialog>
  );
}
