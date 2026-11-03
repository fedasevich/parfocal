import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { Icon } from "@parfocal/ui/components/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@parfocal/ui/components/tooltip";
import {
  type AvatarProfile,
  type PersonInfo,
  personFromProfile,
  readableOn,
} from "@parfocal/ui/lib/avatar-colours";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type Presence = "available" | "busy" | "away";

const presenceColors: Record<Presence, string> = {
  available: "bg-ok",
  busy: "bg-warn",
  away: "bg-fg-faint",
};

const presenceLabels: Record<Presence, string> = {
  available: "Available",
  busy: "Busy",
  away: "Away",
};

type PersonAvatarProps = Omit<AvatarPrimitive.Root.Props, "children" | "style"> & {
  style?: React.CSSProperties | undefined;
  person?: PersonInfo | undefined;
  size?: number | undefined;
  presence?: Presence | undefined;
};

function PersonAvatar({
  person,
  size = 24,
  presence,
  className,
  style,
  ...props
}: PersonAvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="person-avatar"
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full font-semibold text-white select-none",
        person ? "" : "border-[1.5px] border-dashed border-line-strong text-fg-faint",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: person?.color,
        color: person ? readableOn(person.color) : undefined,
        ...style,
      }}
      title={person?.name ?? "Unassigned"}
      {...props}
    >
      <AvatarPrimitive.Fallback>
        {person ? person.initials : <Icon name="user" size="xs" />}
      </AvatarPrimitive.Fallback>
      {presence ? (
        <PresenceDot presence={presence} className="absolute -right-px -bottom-px" />
      ) : null}
    </AvatarPrimitive.Root>
  );
}

type PresenceDotProps = React.ComponentProps<"span"> & { presence: Presence };

function PresenceDot({ presence, className, ...props }: PresenceDotProps) {
  return (
    <span
      data-slot="presence-dot"
      role="img"
      aria-label={presenceLabels[presence]}
      className={cn(
        "inline-block size-2.5 rounded-full border-2 border-chrome",
        presenceColors[presence],
        className,
      )}
      {...props}
    />
  );
}

type PersonProps = React.ComponentProps<"span"> & {
  person?: PersonInfo;
  size?: number;
  sub?: string | boolean;
  you?: boolean;
  short?: boolean;
  presence?: Presence;
};

function shortName(name: string) {
  const [first = "", ...rest] = name.split(" ");
  return `${first[0] ?? ""}. ${rest.join(" ")}`;
}

function Person({
  person,
  size = 24,
  sub,
  you = false,
  short = false,
  presence,
  className,
  ...props
}: PersonProps) {
  const name = person ? (short ? shortName(person.name) : person.name) : "Unassigned";
  const subLine = sub === true ? person?.role : sub || undefined;
  return (
    <span
      data-slot="person"
      className={cn(
        "inline-flex max-w-full min-w-0 items-center align-middle",
        size <= 20 ? "gap-1.5 text-body-sm" : "gap-2",
        className,
      )}
      {...props}
    >
      <PersonAvatar person={person} size={size} presence={presence} />
      <span className="grid min-w-0 leading-tight">
        <span className="font-medium whitespace-nowrap text-fg">
          {name}
          {you ? " (you)" : ""}
        </span>
        {subLine ? (
          <small className="text-caption whitespace-nowrap text-fg-faint">{subLine}</small>
        ) : null}
      </span>
    </span>
  );
}

type AvatarStackProps = React.ComponentProps<"span"> & {
  people: PersonInfo[];
  max?: number;
  size?: number;
};

function AvatarStack({ people, max = 3, size = 24, className, ...props }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const hidden = people.length - shown.length;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-slot="avatar-stack"
            role="img"
            aria-label={people.map((person) => person.name).join(", ")}
            className={cn("inline-flex items-center align-middle", className)}
            {...props}
          />
        }
      >
        {shown.map((person, index) => (
          <PersonAvatar
            key={`${index}-${person.initials}`}
            person={person}
            size={size}
            className={cn("border-2 border-surf-panel", index > 0 ? "-ml-1.5" : "")}
          />
        ))}
        {hidden > 0 ? (
          <span
            data-slot="avatar-stack-count"
            className="-ml-1.5 inline-grid shrink-0 place-items-center rounded-full border-2 border-surf-panel bg-chrome-3 font-mono font-semibold text-fg-dim"
            style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
          >
            +{hidden}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent>{people.map((person) => person.name).join(", ")}</TooltipContent>
    </Tooltip>
  );
}

export {
  type AvatarProfile,
  AvatarStack,
  type AvatarStackProps,
  Person,
  PersonAvatar,
  type PersonAvatarProps,
  type PersonInfo,
  type PersonProps,
  type Presence,
  PresenceDot,
  type PresenceDotProps,
  personFromProfile,
  readableOn,
};
