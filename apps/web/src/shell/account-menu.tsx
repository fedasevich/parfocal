import { type Me, useListTenantMembers } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { PersonAvatar, type PersonInfo, type Presence } from "@parfocal/ui/components/person";
import { SegmentedControl } from "@parfocal/ui/components/segmented-control";
import { Switch } from "@parfocal/ui/components/switch";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toPersonInfo } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { destinations } from "./destinations.ts";
import type { PersonaKey } from "./overlays.ts";
import { useGoTo } from "./router-link.tsx";
import { applyTheme, readTheme, type ThemeChoice } from "./theme.ts";

const presences: { key: Presence; label: string; hint: string; tone: string }[] = [
  {
    key: "available",
    label: "Available",
    hint: "Researchers can give you review tasks",
    tone: "bg-ok",
  },
  { key: "busy", label: "Busy until 15:00", hint: "Nudges wait until then", tone: "bg-warn" },
  {
    key: "away",
    label: "Away",
    hint: "Team shows you as away, so tasks can be reassigned",
    tone: "bg-fg-faint",
  },
];

type MenuEntry = { icon: IconName; label: string; href?: string; keys?: string };

const entries: MenuEntry[] = [
  { icon: "gear", label: "Settings", href: destinations.settings("appearance"), keys: "⌘," },
  {
    icon: "keyboard",
    label: "Keyboard shortcuts",
    href: destinations.settings("shortcuts"),
    keys: "?",
  },
  { icon: "pen", label: "Profile and signature", href: destinations.settings("profile") },
  { icon: "lock", label: "Lock the screen", keys: "⌃⌘Q" },
  { icon: "help", label: "Help and what's new" },
];

const viewAs: PersonaKey[] = ["DH", "LM", "AK", "TB"];

function ViewAs({ current }: { current: string | undefined }) {
  const members = okData(useListTenantMembers().data) ?? [];
  const navigate = useNavigate();
  const shown = viewAs.flatMap((key) => {
    const member = members.find((candidate) => candidate.initials === key);
    return member ? [{ key, person: toPersonInfo(member) }] : [];
  });
  return (
    <>
      <DropdownMenuSeparator />
      <div className="px-2.5 pt-1 pb-0.5 text-caption font-semibold text-fg-dim">
        View as, dev build only
      </div>
      {shown.map(({ key, person }) => (
        <DropdownMenuItem
          key={key}
          onClick={() =>
            void navigate({
              to: ".",
              search: (previous: Record<string, unknown>) => ({
                ...previous,
                as: key === "LM" ? undefined : key,
              }),
            })
          }
          className="grid grid-cols-[18px_1fr_auto] items-center gap-2.5"
        >
          <PersonAvatar person={person} size={18} />
          <span>{person.name}</span>
          {current === person.initials ? <Icon name="check" /> : <span />}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function AccountMenu({ me, person }: { me: Me | undefined; person: PersonInfo }) {
  const [presence, setPresence] = useState(0);
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme());
  const [initialsOnly, setInitialsOnly] = useState(false);
  const goTo = useGoTo();
  const current = presences[presence] ?? presences[0];
  const workspace = me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id);
  const chooseTheme = (choice: ThemeChoice) => {
    setTheme(choice);
    applyTheme(choice);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            title={`${person.name}: theme, settings, log out`}
          />
        }
      >
        <PersonAvatar person={person} size={28} presence={current?.key} />
        <span className="sr-only">Account menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[310px] p-1.5">
        <div className="grid grid-cols-[40px_1fr] items-center gap-3 px-2.5 pt-2.5 pb-2">
          <PersonAvatar person={person} size={40} />
          <div className="min-w-0">
            <b className="block text-body font-semibold text-fg">{person.name}</b>
            <small className="block text-caption text-fg-faint">{person.role}</small>
            <small className="block text-caption text-fg-faint">
              {workspace?.organisation_name ?? workspace?.name}
            </small>
          </div>
        </div>
        <DropdownMenuItem
          closeOnClick={false}
          onClick={() => setPresence((presence + 1) % presences.length)}
          className="mx-1 mb-1 grid grid-cols-[18px_1fr_14px] items-center gap-2.5 border border-line"
        >
          <i className={`size-2.25 justify-self-center rounded-full ${current?.tone ?? ""}`} />
          <span>
            {current?.label}
            <small className="block text-caption text-fg-faint">{current?.hint}</small>
          </span>
          <Icon name="next" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-2.5 px-2.5 py-1.5 text-fg-dim">
          <span>Theme</span>
          <SegmentedControl
            fill
            aria-label="Theme"
            className="w-[172px]"
            value={theme}
            onValueChange={(value) => chooseTheme(value as ThemeChoice)}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
            ]}
          />
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-2.5 px-2.5 py-1.5 text-fg-dim">
          <span>Initials only, for screen sharing</span>
          <Switch size="sm" checked={initialsOnly} onCheckedChange={setInitialsOnly} />
        </label>
        <DropdownMenuSeparator />
        {entries.map((entry) => (
          <DropdownMenuItem
            key={entry.label}
            onClick={() => (entry.href ? void goTo(entry.href) : undefined)}
            className="grid grid-cols-[18px_1fr_auto] items-center gap-2.5"
          >
            <Icon name={entry.icon} />
            <span>{entry.label}</span>
            {entry.keys ? <Keycap keys={entry.keys} /> : <span />}
          </DropdownMenuItem>
        ))}
        {import.meta.env.DEV ? <ViewAs current={me?.initials} /> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="grid grid-cols-[18px_1fr_auto] items-center gap-2.5">
          <Icon name="logout" />
          <span>Log out</span>
          <span />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
