import { type SearchHit, useListProjects, useSearch } from "@parfocal/api-client";
import { CommandPaletteView, type PaletteCommand } from "@parfocal/ui/components/command-palette";
import { Dialog, DialogContent, DialogTitle } from "@parfocal/ui/components/dialog";
import type { IconName } from "@parfocal/ui/components/icon";
import { useParams, useRouter, useRouterState } from "@tanstack/react-router";
import { type KeyboardEvent, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { destinations } from "./destinations.ts";
import { setDeveloperMode, useDeveloperMode } from "./developer-mode.ts";
import { useOverlay } from "./overlays.ts";
import { type PaletteGroup, paletteEntries, paletteGroups } from "./palette-commands.ts";
import { matchCommand, matchText } from "./palette-match.ts";
import { useGoTo } from "./router-link.tsx";

const hitIcons: Record<SearchHit["kind"], IconName> = {
  project: "folder",
  case: "file",
  slide: "slides",
  object: "target",
  person: "user",
  "patient-case": "file",
};

function hitHref(hit: SearchHit): string | null {
  const projectId = hit.project?.id;
  if (hit.kind === "project") return destinations.project(hit.id);
  if ((hit.kind === "slide" || hit.kind === "object") && projectId && hit.slide_id) {
    return destinations.slide(projectId, hit.slide_id, undefined, hit.object_id ?? undefined);
  }
  if (hit.kind === "case" && projectId) return destinations.project(projectId);
  return null;
}

type Row = PaletteCommand & { group: PaletteGroup; score: number };

const perGroupLimit = 8;

function hitRow(hit: SearchHit, query: string, run: () => void): Row {
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

function usePlaces(query: string, close: () => void): Row[] {
  const goTo = useGoTo();
  const projects = okData(useListProjects().data) ?? [];
  const hits =
    okData(useSearch({ q: query }, { query: { enabled: query.length >= 2 } }).data)?.hits ?? [];
  if (query.length < 2) return [];
  const open = (href: string) => () => {
    close();
    void goTo(href);
  };
  const fromServer = hits.flatMap((hit) => {
    const href = hitHref(hit);
    return href === null ? [] : [hitRow(hit, query, open(href))];
  });
  const known = new Set(fromServer.map((row) => row.id));
  const fromList = projects.flatMap((project) => {
    const hit: SearchHit = {
      kind: "project",
      id: project.id,
      label: `${project.code} · ${project.name}`,
    };
    if (matchText(hit.label, query) === null) return [];
    const row = hitRow(hit, query, open(destinations.project(project.id)));
    return known.has(row.id) ? [] : [row];
  });
  return [...fromServer, ...fromList];
}

function PaletteBody({ initial, close }: { initial: string; close: () => void }) {
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const goTo = useGoTo();
  const router = useRouter();
  const overlay = useOverlay();
  const params = useParams({ strict: false });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const developerMode = useDeveloperMode();
  const projects = okData(useListProjects().data) ?? [];
  const trimmed = query.trim();
  const places = usePlaces(trimmed, close);
  const entries = paletteEntries({
    projectId: params.projectId ?? projects[0]?.id ?? "",
    onSlide: /^\/projects\/[^/]+\/slides\/[^/]+$/.test(pathname),
    developerMode,
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
  });
  const local = entries.flatMap((entry): Row[] => {
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
  const commands = byGroup
    .filter((entry) => entry.rows.length > 0)
    .sort((a, b) => (b.rows[0]?.score ?? 0) - (a.rows[0]?.score ?? 0) || a.order - b.order)
    .flatMap((entry) => entry.rows);
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
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <PaletteBody initial={overlay.find ?? ""} close={close} />
      </DialogContent>
    </Dialog>
  );
}
