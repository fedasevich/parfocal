import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { PersonAvatar, type PersonInfo } from "@parfocal/ui/components/person";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";
import { useId, useState } from "react";

type TokenItem = {
  id: string;
  name: string;
  sub?: string;
  person?: PersonInfo;
  thumbnail?: string;
  end?: string;
  endTone?: "warn" | undefined;
  find?: string;
  dim?: string;
  icon?: IconName;
};

type TokenProps = React.ComponentProps<"span"> & {
  item: TokenItem;
  onRemove?: (() => void) | undefined;
};

function TokenLead({ item }: { item: TokenItem }) {
  if (item.person) return <PersonAvatar person={item.person} size={20} />;
  if (item.thumbnail) {
    return (
      <span
        aria-hidden="true"
        className="size-5 shrink-0 rounded-sm border border-line bg-cover bg-center"
        style={{ backgroundImage: `url(${item.thumbnail})` }}
      />
    );
  }
  if (item.icon) {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-chrome-3 text-fg-dim">
        <Icon name={item.icon} size="xs" />
      </span>
    );
  }
  return null;
}

const hasLead = (item: TokenItem) => Boolean(item.person || item.thumbnail || item.icon);

function Token({ item, onRemove, className, ...props }: TokenProps) {
  return (
    <span
      data-slot="token"
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] px-1 text-body-sm text-fg",
        className,
      )}
      {...props}
    >
      <TokenLead item={item} />
      <span className="truncate">{item.name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          className="grid size-5 cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-fg-faint hover:bg-[color-mix(in_srgb,var(--fg)_10%,transparent)] hover:text-fg"
        >
          <Icon name="close" size="xs" />
        </button>
      ) : null}
    </span>
  );
}

type TokenFieldProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  label: string;
  items: TokenItem[];
  picked: string[];
  onPickedChange?: (ids: string[]) => void;
  placeholder?: string;
  defaultQuery?: string;
  defaultOpen?: boolean;
  onInvite?: (email: string) => void;
  invalid?: boolean;
  single?: boolean;
};

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function TokenField({
  label,
  items,
  picked,
  onPickedChange,
  placeholder = "Type a name or an email",
  defaultQuery = "",
  defaultOpen = false,
  onInvite,
  invalid = false,
  single = false,
  className,
  ...props
}: TokenFieldProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  const pickedItems = picked
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is TokenItem => item !== undefined);
  const needle = fold(query.trim());
  const matches = items.filter(
    (item) =>
      !picked.includes(item.id) &&
      (needle === "" || fold(`${item.name} ${item.find ?? ""}`).includes(needle)),
  );
  const inviteable = emailPattern.test(query.trim()) && matches.length === 0;
  const full = single && pickedItems.length > 0;
  const listOpen = open && !full && (matches.length > 0 || inviteable);
  const pick = (id: string) => {
    onPickedChange?.([...picked, id]);
    setQuery("");
    if (single) setOpen(false);
  };
  return (
    <div data-slot="token-field" className={cn("relative min-w-0", className)} {...props}>
      <div
        data-invalid={invalid || undefined}
        className="flex min-h-10 cursor-text flex-wrap items-center gap-1.5 rounded-ctl border border-line-strong bg-surf-field px-2 py-1.25 focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)] data-invalid:border-bad data-invalid:focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--bad)_22%,transparent)]"
      >
        {pickedItems.map((item) => (
          <Token
            key={item.id}
            item={item}
            onRemove={
              onPickedChange
                ? () => onPickedChange(picked.filter((id) => id !== item.id))
                : undefined
            }
          />
        ))}
        {full ? null : (
          <input
            role="combobox"
            aria-label={label}
            aria-expanded={listOpen}
            aria-controls={listOpen ? listId : undefined}
            aria-autocomplete="list"
            aria-invalid={invalid || undefined}
            value={query}
            placeholder={pickedItems.length ? "Add another" : placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            className="h-7 min-w-35 flex-1 border-0 bg-transparent px-1 text-body-sm text-fg outline-none placeholder:text-fg-faint"
          />
        )}
      </div>
      {listOpen ? (
        <div
          id={listId}
          role="listbox"
          aria-label={`${label} matches`}
          className="absolute top-[calc(100%+4px)] right-0 left-0 z-40 grid max-h-63 gap-px overflow-auto rounded-zone border border-line-strong bg-chrome p-1 shadow-pop"
        >
          {matches.map((item) => (
            <div
              key={item.id}
              role="option"
              aria-selected="false"
              aria-disabled={item.dim ? true : undefined}
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault();
                if (!item.dim) pick(item.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !item.dim) pick(item.id);
              }}
              className={cn(
                "grid min-h-12 items-center gap-2.5 rounded-md px-2 py-1.5",
                hasLead(item)
                  ? "grid-cols-[auto_minmax(0,1fr)_auto]"
                  : "grid-cols-[minmax(0,1fr)_auto]",
                item.dim
                  ? "cursor-default opacity-60"
                  : "cursor-pointer hover:bg-[color-mix(in_srgb,var(--fg)_7%,transparent)]",
              )}
            >
              <TokenLead item={item} />
              <span className="min-w-0">
                <b className="block text-body-sm font-medium">{item.name}</b>
                {item.sub ? (
                  <small className="block truncate text-caption text-fg-dim">{item.sub}</small>
                ) : null}
              </span>
              <span
                className={cn(
                  "text-caption whitespace-nowrap",
                  item.endTone === "warn" ? "text-warn" : "text-fg-dim",
                )}
              >
                {item.dim ?? item.end}
              </span>
            </div>
          ))}
          {inviteable ? (
            <div
              role="option"
              aria-selected="false"
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault();
                onInvite?.(query.trim());
                setQuery("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") onInvite?.(query.trim());
              }}
              className="grid min-h-12 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-[color-mix(in_srgb,var(--fg)_7%,transparent)]"
            >
              <TokenLead item={{ id: "invite", name: query, icon: "mail" }} />
              <span>
                <b className="block text-body-sm font-medium">Invite {query.trim()} by email</b>
                <small className="block text-caption text-fg-dim">
                  They get a one-step sign-up, then the task
                </small>
              </span>
            </div>
          ) : null}
          {matches.length === 0 && !inviteable ? (
            <div className="p-2 text-body-sm text-fg-dim">
              No one called that. Type an email to invite them.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { Token, TokenField, type TokenFieldProps, type TokenItem, type TokenProps };
