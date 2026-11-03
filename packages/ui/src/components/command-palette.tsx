import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { cn } from "@parfocal/ui/lib/utils";
import type { KeyboardEventHandler } from "react";

type PaletteCommand = {
  id: string;
  group: string;
  icon: IconName;
  label: string;
  keys?: string | undefined;
  matched?: readonly number[] | undefined;
  run: () => void;
};

type CommandPaletteViewProps = {
  query: string;
  onQueryChange: (query: string) => void;
  commands: readonly PaletteCommand[];
  groups: readonly string[];
  current: number;
  onCurrentChange: (index: number) => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
};

function Highlight({
  text,
  query,
  matched,
}: {
  text: string;
  query: string;
  matched?: readonly number[] | undefined;
}) {
  if (matched !== undefined) {
    if (matched.length === 0) return <span>{text}</span>;
    const marked = new Set(matched);
    const runs: { at: number; text: string; on: boolean }[] = [];
    Array.from(text).forEach((char, at) => {
      const on = marked.has(at);
      const last = runs[runs.length - 1];
      if (last && last.on === on) last.text += char;
      else runs.push({ at, text: char, on });
    });
    return (
      <span>
        {runs.map((run) =>
          run.on ? (
            <mark key={run.at} className="bg-transparent font-semibold text-fg">
              {run.text}
            </mark>
          ) : (
            <span key={run.at}>{run.text}</span>
          ),
        )}
      </span>
    );
  }
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, at)}
      <mark className="bg-transparent font-semibold text-fg">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </span>
  );
}

function CommandPaletteView({
  query,
  onQueryChange,
  commands,
  groups,
  current,
  onCurrentChange,
  onKeyDown,
}: CommandPaletteViewProps) {
  const trimmed = query.trim();
  return (
    <>
      <div className="flex items-center gap-2.5 border-line border-b px-4 py-3.5 text-[16px] focus-within:border-b-accent">
        <Icon name="search" className="text-fg-dim" />
        <input
          aria-label="Search actions, places and settings"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={commands[current] ? `palette-${commands[current].id}` : undefined}
          className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-fg-faint"
          placeholder="Search actions, slides, IDs like T2·C145 and settings"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Keycap keys="Esc" />
      </div>
      <div
        id="palette-results"
        role={commands.length > 0 ? "listbox" : undefined}
        className="max-h-[60vh] overflow-auto"
      >
        {groups.map((group) => {
          const inGroup = commands.filter((command) => command.group === group);
          if (inGroup.length === 0) return null;
          return (
            <div key={group} role="presentation" className="grid gap-px p-2">
              <span className="px-2.5 pt-1.5 pb-1 text-caption font-semibold text-fg-dim">
                {group}
              </span>
              {inGroup.map((command) => {
                const on = commands[current]?.id === command.id;
                return (
                  <div
                    key={command.id}
                    id={`palette-${command.id}`}
                    role="option"
                    aria-selected={on}
                    tabIndex={-1}
                    onClick={command.run}
                    onKeyDown={(event) => (event.key === "Enter" ? command.run() : undefined)}
                    onMouseMove={() => onCurrentChange(commands.indexOf(command))}
                    className={cn(
                      "grid cursor-pointer grid-cols-[22px_1fr_auto] items-center gap-2.5 rounded-lg px-2.5 py-2 text-body",
                      on ? "bg-accent-soft text-fg" : "text-fg-dim",
                    )}
                  >
                    <Icon name={command.icon} />
                    <Highlight text={command.label} query={trimmed} matched={command.matched} />
                    {command.keys ? <Keycap keys={command.keys} /> : <span />}
                  </div>
                );
              })}
            </div>
          );
        })}
        {commands.length === 0 ? (
          <p className="px-5 py-6 text-body-sm text-fg-dim">Nothing matches "{trimmed}".</p>
        ) : null}
      </div>
      <div className="flex gap-3.5 border-line border-t px-4 py-2 text-body-sm text-fg-dim">
        <span className="inline-flex items-center gap-1">
          <Keycap keys="↑" size="sm" />
          <Keycap keys="↓" size="sm" /> choose
        </span>
        <span className="inline-flex items-center gap-1">
          <Keycap keys="↵" size="sm" /> run
        </span>
        <span>Every action in the app is here, with its key</span>
      </div>
    </>
  );
}

export { CommandPaletteView, type CommandPaletteViewProps, type PaletteCommand };
