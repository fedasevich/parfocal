import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@parfocal/ui/components/dropdown-menu";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { PersonAvatar, type PersonInfo, type Presence } from "@parfocal/ui/components/person";
import { lazyText } from "@parfocal/ui/lib/lazy-text";
import type { ReactNode } from "react";

type AccountPresence = { key: Presence; label: string; hint: string; tone: string };

type AccountEntry = {
  icon: IconName;
  label: string;
  keys?: string;
  onSelect?: () => void;
  disabledReason?: string;
};

type AccountTheme = "dark" | "light" | "system";

type AccountMenuProps = {
  person: PersonInfo;
  organisation?: string | undefined;
  presence: AccountPresence;
  statuses: readonly AccountPresence[];
  onPresenceChange: (key: Presence) => void;
  presenceBusy?: boolean;
  theme: AccountTheme;
  onThemeChange: (theme: AccountTheme) => void;
  initialsOnly: boolean;
  onInitialsOnlyChange: (value: boolean) => void;
  entries: readonly AccountEntry[];
  extra?: ReactNode;
  onLogOut?: () => void;
  defaultOpen?: boolean;
};

const themes: readonly [AccountTheme, string][] = lazyText(() => [
  ["dark", t`Dark`],
  ["light", t`Light`],
  ["system", t`System`],
]);

const rowClass = "grid grid-cols-[18px_1fr_auto] items-center gap-2.5";

function AccountMenu({
  person,
  organisation,
  presence,
  statuses,
  onPresenceChange,
  presenceBusy,
  theme,
  onThemeChange,
  initialsOnly,
  onInitialsOnlyChange,
  entries,
  extra,
  onLogOut,
  defaultOpen,
}: AccountMenuProps) {
  const { t } = useLingui();

  return (
    <DropdownMenu {...(defaultOpen === undefined ? {} : { defaultOpen })}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            title={
              person.name
                ? t`${person.name}: theme, settings, log out`
                : t`Theme, settings, log out`
            }
          />
        }
      >
        <PersonAvatar person={person} size={28} presence={presence.key} />
        <span className="sr-only">
          <Trans>Account menu</Trans>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[310px] p-1.5">
        <div
          role="group"
          aria-label={t`Signed in as`}
          className="grid grid-cols-[40px_1fr] items-center gap-3 px-2.5 pt-2.5 pb-2"
        >
          <PersonAvatar person={person} size={40} />
          <div className="min-w-0">
            <b
              data-testid="account-name"
              className="block truncate text-body font-semibold text-fg"
            >
              {person.name}
            </b>
            <small className="block truncate text-caption text-fg-faint">{person.role}</small>
            <small className="block truncate text-caption text-fg-faint">{organisation}</small>
          </div>
        </div>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={presenceBusy ?? false}
            className="mx-1 mb-1 grid grid-cols-[18px_1fr_14px] items-center gap-2.5 border border-line px-2.5 py-1.5"
          >
            <i className={`size-2.25 justify-self-center rounded-full ${presence.tone}`} />
            <span>
              {presence.label}
              <small className="block text-caption text-fg-faint">{presence.hint}</small>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[280px] p-1.5">
            <MenuPrimitive.RadioGroup
              value={presence.key}
              onValueChange={(value) => onPresenceChange(value as Presence)}
            >
              {statuses.map((status) => (
                <MenuPrimitive.RadioItem
                  key={status.key}
                  value={status.key}
                  disabled={presenceBusy ?? false}
                  className="grid cursor-pointer grid-cols-[18px_1fr_16px] items-center gap-2.5 rounded-md px-2.5 py-1.5 outline-none data-highlighted:bg-chrome-2"
                >
                  <i className={`size-2.25 justify-self-center rounded-full ${status.tone}`} />
                  <span>
                    {status.label}
                    <small className="block text-caption text-fg-faint">{status.hint}</small>
                  </span>
                  <MenuPrimitive.RadioItemIndicator className="text-accent">
                    <Icon name="check" />
                  </MenuPrimitive.RadioItemIndicator>
                </MenuPrimitive.RadioItem>
              ))}
            </MenuPrimitive.RadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-2.5 px-2.5 py-1.5 text-fg-dim">
          <span id="account-theme">
            <Trans>Theme</Trans>
          </span>
          <MenuPrimitive.RadioGroup
            aria-labelledby="account-theme"
            value={theme}
            onValueChange={(value) => onThemeChange(value as AccountTheme)}
            className="grid w-[172px] grid-cols-3 gap-0.5 rounded-ctl bg-chrome-2 p-0.5"
          >
            {themes.map(([value, label]) => (
              <MenuPrimitive.RadioItem
                key={value}
                value={value}
                closeOnClick={false}
                className="cursor-pointer rounded-md px-2 py-1 text-center text-body-sm outline-none data-checked:bg-chrome-3 data-checked:font-semibold data-checked:text-fg data-highlighted:bg-chrome-3"
              >
                {label}
              </MenuPrimitive.RadioItem>
            ))}
          </MenuPrimitive.RadioGroup>
        </div>
        <MenuPrimitive.CheckboxItem
          checked={initialsOnly}
          onCheckedChange={onInitialsOnlyChange}
          closeOnClick={false}
          className="flex cursor-pointer items-center justify-between gap-2.5 rounded-md px-2.5 py-1.5 text-fg-dim outline-none data-highlighted:bg-chrome-2"
        >
          <span>
            <Trans>Initials only, for screen sharing</Trans>
          </span>
          <span
            aria-hidden="true"
            className="relative h-3.5 w-6 shrink-0 rounded-full bg-input data-[on=true]:bg-primary"
            data-on={initialsOnly}
          >
            <span
              className={`absolute top-0.5 size-2.5 rounded-full bg-background transition-all ${initialsOnly ? "left-3" : "left-0.5"}`}
            />
          </span>
        </MenuPrimitive.CheckboxItem>
        <DropdownMenuSeparator />
        {entries.map((entry) => (
          <DropdownMenuItem
            key={entry.label}
            onClick={entry.onSelect}
            disabled={entry.disabledReason !== undefined}
            title={entry.disabledReason}
            className={rowClass}
          >
            <Icon name={entry.icon} />
            <span>
              {entry.label}
              {entry.disabledReason ? (
                <small className="block text-caption text-fg-faint">{entry.disabledReason}</small>
              ) : null}
            </span>
            {entry.keys ? <Keycap keys={entry.keys} /> : <span />}
          </DropdownMenuItem>
        ))}
        {extra}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogOut} className={rowClass}>
          <Icon name="logout" />
          <span>
            <Trans>Log out</Trans>
          </span>
          <span />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export {
  type AccountEntry,
  AccountMenu,
  type AccountMenuProps,
  type AccountPresence,
  type AccountTheme,
};
