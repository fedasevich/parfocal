import { Icon } from "@parfocal/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { cn } from "@parfocal/ui/lib/utils";
import { type KeyboardEvent, useId, useRef, useState } from "react";

type FilterOption = {
  value: string;
  label: string;
  hint?: string;
};

type FilterChipProps = {
  label: string;
  anyLabel?: string;
  options: FilterOption[];
  value: string | undefined;
  onValueChange: (value: string | undefined) => void;
  searchAbove?: number;
  defaultOpen?: boolean;
  className?: string;
};

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function FilterChip({
  label,
  anyLabel = "any",
  options,
  value,
  onValueChange,
  searchAbove = 6,
  defaultOpen = false,
  className,
}: FilterChipProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const picked = value === undefined ? undefined : options.find((option) => option.value === value);
  const shown = value === undefined ? anyLabel : (picked?.label ?? value);
  const searchable = options.length > searchAbove;
  const needle = fold(search.trim());
  const matches = needle
    ? options.filter((option) => fold(`${option.label} ${option.hint ?? ""}`).includes(needle))
    : options;

  const buttons = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);

  const choose = (next: string | undefined) => {
    onValueChange(next);
    setOpen(false);
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = buttons();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const jump = (index: number) => {
      event.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, index))]?.focus();
    };
    if (event.key === "ArrowDown") jump(at + 1);
    if (event.key === "ArrowUp") jump(at - 1);
    if (event.key === "Home") jump(0);
    if (event.key === "End") jump(items.length - 1);
  };

  const row = (optionValue: string | undefined, text: string, hint?: string) => {
    const on = optionValue === value;
    return (
      <button
        key={optionValue ?? "__any"}
        type="button"
        role="option"
        aria-selected={on}
        tabIndex={on || (value === undefined && optionValue === undefined) ? 0 : -1}
        onClick={() => choose(optionValue)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-ctl border-0 bg-transparent px-2 py-1.5 text-left text-body-sm text-fg outline-none hover:bg-chrome-3 focus-visible:bg-chrome-3 focus-visible:outline-2 focus-visible:outline-accent",
          on && "bg-accent-soft",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{text}</span>
        {hint ? <span className="font-mono text-caption text-fg-faint">{hint}</span> : null}
        <Icon name="check" size="sm" className={cn("text-accent", !on && "invisible")} />
      </button>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger
        data-slot="filter-chip"
        data-active={value === undefined ? undefined : true}
        aria-label={`${label}: ${shown}`}
        className={cn(
          "inline-flex h-7 cursor-pointer items-center gap-1 whitespace-nowrap rounded-ctl border border-line-strong bg-btn-bg px-2.5 text-caption font-medium text-fg outline-none hover:border-fg-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-expanded:border-fg-faint data-active:border-accent data-active:bg-accent-soft",
          className,
        )}
      >
        <span aria-hidden="true">
          {label}: {shown}
        </span>
        <Icon name="down" size="sm" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`Filter by ${label.toLowerCase()}`}
        className="w-64 gap-1.5 p-1.5"
      >
        {searchable ? (
          <input
            aria-label={`Find a ${label.toLowerCase()}`}
            aria-controls={listId}
            placeholder={`Find a ${label.toLowerCase()}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                buttons()[0]?.focus();
              }
            }}
            className="h-7 rounded-ctl border border-line-strong bg-surf-field px-2 text-body-sm text-fg outline-none placeholder:text-fg-faint focus:border-accent"
          />
        ) : null}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          onKeyDown={onListKey}
          className="flex max-h-64 flex-col overflow-y-auto"
        >
          {needle ? null : row(undefined, `Any ${label.toLowerCase()}`)}
          {matches.map((option) => row(option.value, option.label, option.hint))}
        </div>
        {matches.length === 0 ? (
          <p className="m-0 px-2 py-1.5 text-body-sm text-fg-dim">
            {options.length === 0 ? "Nothing to filter by yet." : "Nothing matches that."}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export { FilterChip, type FilterChipProps, type FilterOption };
