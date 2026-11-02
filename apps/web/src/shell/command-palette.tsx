import { type SearchHit, useListProjects, useSearch } from "@parfocal/api-client";
import { CommandPaletteView } from "@parfocal/ui/components/command-palette";
import { Dialog, DialogContent, DialogTitle } from "@parfocal/ui/components/dialog";
import type { IconName } from "@parfocal/ui/components/icon";
import { useParams } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { destinations } from "./destinations.ts";
import { useOverlay } from "./overlays.ts";
import { useGoTo } from "./router-link.tsx";

type Command = {
  id: string;
  group: "Actions" | "Go to" | "Settings";
  icon: IconName;
  label: string;
  keys?: string;
  run: () => void;
};

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

function useCommands(close: () => void): Command[] {
  const goTo = useGoTo();
  const overlay = useOverlay();
  const params = useParams({ strict: false });
  const projects = okData(useListProjects().data) ?? [];
  const projectId = params.projectId ?? projects[0]?.id ?? "";
  const to = (href: string) => () => {
    close();
    void goTo(href);
  };
  return [
    { id: "measure", group: "Actions", icon: "ruler", label: "Measure", keys: "L", run: close },
    {
      id: "measurements",
      group: "Actions",
      icon: "search",
      label: "Measurements in this case",
      run: close,
    },
    {
      id: "upload",
      group: "Actions",
      icon: "upload",
      label: "Upload slides and results",
      run: to(destinations.upload(projectId)),
    },
    {
      id: "run-model",
      group: "Actions",
      icon: "smart",
      label: "Run a model",
      run: to(destinations.runModel(projectId)),
    },
    {
      id: "new-task",
      group: "Actions",
      icon: "users",
      label: "New review task",
      run: to(destinations.newReviewTask(projectId)),
    },
    {
      id: "my-work",
      group: "Actions",
      icon: "slides",
      label: "Open My work",
      run: to(destinations.myWork()),
    },
    {
      id: "home",
      group: "Actions",
      icon: "home",
      label: "Open Home",
      run: to(destinations.home()),
    },
    {
      id: "bell",
      group: "Actions",
      icon: "bell",
      label: "Notifications",
      run: () => void overlay.set("notifications"),
    },
    {
      id: "brightness",
      group: "Settings",
      icon: "sun",
      label: "Slide brightness",
      keys: "Alt+↑ ↓",
      run: to(destinations.settings("display")),
    },
    {
      id: "units",
      group: "Settings",
      icon: "gear",
      label: "Units and measurement display",
      run: to(destinations.settings("display")),
    },
    {
      id: "wheel",
      group: "Settings",
      icon: "gear",
      label: "Mouse wheel",
      run: to(destinations.settings("navigation")),
    },
    {
      id: "theme",
      group: "Settings",
      icon: "sun",
      label: "Theme",
      run: to(destinations.settings("display")),
    },
    {
      id: "shortcuts",
      group: "Settings",
      icon: "keyboard",
      label: "Keyboard shortcuts",
      keys: "?",
      run: to(destinations.settings("shortcuts")),
    },
  ];
}

const groups = ["Actions", "Go to", "Settings"] as const;

function PaletteBody({ initial, close }: { initial: string; close: () => void }) {
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const goTo = useGoTo();
  const trimmed = query.trim();
  const hits =
    okData(useSearch({ q: trimmed }, { query: { enabled: trimmed.length >= 2 } }).data)?.hits ?? [];
  const local = useCommands(close).filter(
    (command) => !trimmed || command.label.toLowerCase().includes(trimmed.toLowerCase()),
  );
  const found: Command[] = hits.flatMap((hit) => {
    const href = hitHref(hit);
    if (href === null) return [];
    return [
      {
        id: `hit-${hit.kind}-${hit.id}`,
        group: "Go to" as const,
        icon: hitIcons[hit.kind],
        label:
          hit.project && hit.kind !== "project" ? `${hit.label} · ${hit.project.code}` : hit.label,
        run: () => {
          close();
          void goTo(href);
        },
      },
    ];
  });
  const commands = groups.flatMap((group) =>
    [...local, ...found].filter((command) => command.group === group),
  );
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
      groups={groups}
      current={current}
      onCurrentChange={setActive}
      onKeyDown={onKeyDown}
    />
  );
}

export function CommandPalette() {
  const overlay = useOverlay();
  const isOpen = overlay.open === "palette";
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        void overlay.set(isOpen ? undefined : "palette");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const close = () => void overlay.set(undefined);
  return (
    <Dialog open={isOpen} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        showCloseButton={false}
        className="top-[110px] translate-y-0 gap-0 overflow-hidden bg-chrome p-0 sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        {isOpen ? <PaletteBody initial={overlay.find ?? ""} close={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}
