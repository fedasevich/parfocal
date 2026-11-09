import {
  getGetMyAvailabilityQueryKey,
  type Me,
  useGetMyAvailability,
  useListTenantMembers,
  useSetMyAvailability,
} from "@parfocal/api-client";
import { AccountMenu as AccountMenuView } from "@parfocal/ui/components/account-menu";
import { DropdownMenuItem, DropdownMenuSeparator } from "@parfocal/ui/components/dropdown-menu";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { PersonAvatar, type PersonInfo } from "@parfocal/ui/components/person";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { now } from "../clock.ts";
import { openFeedback } from "../feedback/feedback-state.ts";
import { openHelp } from "../help/tour-state.ts";
import { toPersonInfo } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { nextAvailability, presenceOf, shownPerson } from "./account-presence.ts";
import { destinations } from "./destinations.ts";
import type { PersonaKey } from "./overlays.ts";
import { useGoTo } from "./router-link.tsx";
import { shellStore, useShell } from "./shell-store.ts";
import { readTheme, chooseTheme as storeTheme, type ThemeChoice } from "./theme.ts";

export const logOutUrl = "/api/auth/logout";

const entries = [
  { icon: "gear", label: "Settings", href: destinations.settings("display"), keys: "⌘," },
  {
    icon: "keyboard",
    label: "Keyboard shortcuts",
    href: destinations.settings("shortcuts"),
    keys: "?",
  },
  { icon: "pen", label: "Profile and signature", href: destinations.settings("account") },
  {
    icon: "lock",
    label: "Lock the screen",
    keys: "⌃⌘Q",
    disabledReason: "Locks after a quiet spell for now",
  },
  { icon: "comment", label: "Send feedback", action: "feedback" },
  { icon: "help", label: "Help and tour", action: "help" },
] satisfies {
  icon: IconName;
  label: string;
  href?: string;
  action?: "feedback" | "help";
  keys?: string;
  disabledReason?: string;
}[];

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
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme());
  const initialsOnly = useShell((state) => state.initialsOnly);
  const goTo = useGoTo();
  const queryClient = useQueryClient();
  const availability = okData(useGetMyAvailability().data);
  const setAvailability = useSetMyAvailability({
    mutation: {
      onSuccess: (response) => {
        queryClient.setQueryData(getGetMyAvailabilityQueryKey(), response);
      },
    },
  });
  const workspace = me?.workspaces.find((item) => item.tenant_id === me.active_tenant_id);
  const chooseTheme = (choice: ThemeChoice) => {
    setTheme(choice);
    storeTheme(choice);
  };
  return (
    <AccountMenuView
      person={shownPerson(person, initialsOnly)}
      organisation={workspace?.organisation_name ?? workspace?.name}
      presence={presenceOf(availability, now())}
      onNextPresence={() => setAvailability.mutate({ data: nextAvailability(availability, now()) })}
      presenceBusy={setAvailability.isPending}
      theme={theme}
      onThemeChange={chooseTheme}
      initialsOnly={initialsOnly}
      onInitialsOnlyChange={(value) => shellStore.setState({ initialsOnly: value })}
      entries={entries.map(({ href, action, ...entry }) => ({
        ...entry,
        ...(href ? { onSelect: () => void goTo(href) } : {}),
        ...(action === "feedback" ? { onSelect: openFeedback } : {}),
        ...(action === "help" ? { onSelect: openHelp } : {}),
      }))}
      extra={import.meta.env.DEV ? <ViewAs current={me?.initials} /> : null}
      onLogOut={() => window.location.assign(logOutUrl)}
    />
  );
}
