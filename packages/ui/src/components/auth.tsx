import { Button } from "@parfocal/ui/components/button";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Person, PersonAvatar, type PersonInfo } from "@parfocal/ui/components/person";
import { StatusTag } from "@parfocal/ui/components/tag";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type AuthWorkspace = { name: string; logo: string; colour: string; note?: string };

function WorkspaceLogo({ workspace, size = 30 }: { workspace: AuthWorkspace; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center font-bold text-white"
      style={{
        background: workspace.colour,
        width: size,
        height: size,
        borderRadius: size > 24 ? 8 : 5,
        fontSize: size > 24 ? 11 : 8.5,
      }}
    >
      {workspace.logo}
    </span>
  );
}

function AuthBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg border border-white/30 text-accent">
        <Icon name="parfocal" size="md" />
      </span>
      <b className="text-title font-bold tracking-[-0.01em]">Parfocal</b>
    </div>
  );
}

function AuthWorkspaceLine({ workspace, plain }: { workspace: AuthWorkspace; plain?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 border-t pt-4",
        plain ? "mt-auto border-line" : "border-white/20",
      )}
    >
      <WorkspaceLogo workspace={workspace} />
      <span>
        <b className="block text-body-sm">{workspace.name}</b>
        <small className="block text-body-sm leading-[1.45] opacity-80">
          {workspace.note ?? "Your workspace · sign-in managed by its IT"}
        </small>
      </span>
    </div>
  );
}

type PitchId = { id: string; text: string; x: number; y: number };

type AuthPitchSideProps = {
  workspace: AuthWorkspace;
  imageUrl?: string;
  headline?: React.ReactNode;
  points?: { icon: IconName; text: string }[];
  ids?: PitchId[];
};

const defaultPoints: { icon: IconName; text: string }[] = [
  { icon: "upload", text: "Import results from any model, or run one here" },
  { icon: "flag", text: "Every tumor, cell and region has an ID you can cite" },
  { icon: "users", text: "Blind reviews, a disagreement queue and a signed evaluation" },
];

function AuthPitchSide({
  workspace,
  imageUrl,
  headline = (
    <>
      See what the AI found.
      <br />
      Say what you think.
    </>
  ),
  points = defaultPoints,
  ids = [],
}: AuthPitchSideProps) {
  return (
    <aside
      data-slot="auth-side"
      className="relative flex flex-col gap-5 overflow-hidden bg-[#0c111c] bg-cover bg-center px-9 py-8 text-[#f5f5f5]"
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,12,20,.6)_0%,rgba(9,12,20,.3)_38%,rgba(9,12,20,.94)_72%)]"
      />
      <div className="relative">
        <AuthBrand />
      </div>
      <div className="relative mt-auto grid gap-4">
        <h1 className="m-0 text-display leading-[1.15] font-semibold tracking-[-0.01em]">
          {headline}
        </h1>
        <div className="grid gap-2.5">
          {points.map((point) => (
            <span key={point.text} className="flex items-center gap-2.5 text-body text-white/90">
              <Icon name={point.icon} />
              {point.text}
            </span>
          ))}
        </div>
      </div>
      {ids.map((item) => (
        <span
          key={item.id}
          aria-hidden="true"
          className="absolute flex items-center gap-1.75 rounded-[7px] border border-white/25 bg-[rgba(12,17,28,.8)] px-2.25 py-1.25 text-caption text-white/90 before:absolute before:top-1/2 before:-left-4 before:size-2.5 before:-translate-y-1/2 before:rounded-full before:border-2 before:border-[#fca5a5]"
          style={{ left: item.x, top: item.y }}
        >
          <b className="font-mono text-caption font-semibold text-[#fca5a5]">{item.id}</b>
          {item.text}
        </span>
      ))}
      <div className="relative">
        <AuthWorkspaceLine workspace={workspace} />
      </div>
    </aside>
  );
}

type AuthStep = { name: string; sub: string };

type AuthStepsSideProps = {
  workspace: AuthWorkspace;
  steps: AuthStep[];
  current: number;
  reached: number;
  onStepSelect?: (index: number) => void;
  note?: React.ReactNode;
};

function AuthStepsSide({
  workspace,
  steps,
  current,
  reached,
  onStepSelect,
  note,
}: AuthStepsSideProps) {
  return (
    <aside
      data-slot="auth-side"
      className="flex flex-col gap-5 overflow-hidden border-r border-line bg-chrome px-9 py-8 text-fg"
    >
      <AuthBrand />
      <ol aria-label="Setup steps" className="m-0 grid list-none gap-1 p-0">
        {steps.map((step, index) => {
          const done = index !== current && index <= reached;
          const can = index !== current && index <= reached && onStepSelect !== undefined;
          return (
            <li key={step.name}>
              <button
                type="button"
                disabled={!can}
                aria-current={index === current ? "step" : undefined}
                title={
                  index === current || can
                    ? undefined
                    : "Not reached yet. Use Next or Skip this step to get here."
                }
                onClick={() => onStepSelect?.(index)}
                className={cn(
                  "grid w-full grid-cols-[26px_minmax(0,1fr)] items-start gap-3 rounded-ctl border-0 bg-transparent px-2 py-2 text-left",
                  can ? "cursor-pointer hover:bg-chrome-2" : "cursor-default",
                  index === current && "bg-chrome-2",
                )}
              >
                <i
                  aria-hidden="true"
                  className={cn(
                    "grid size-6.5 place-items-center rounded-full border text-caption font-semibold not-italic",
                    index === current
                      ? "border-accent bg-(--accent) text-on-accent"
                      : done
                        ? "border-accent text-accent"
                        : "border-line-strong text-fg-faint",
                  )}
                >
                  {done ? <Icon name="check" size="xs" /> : index + 1}
                </i>
                <span className="grid">
                  <b className={cn("text-body-sm", index > reached && "text-fg-dim")}>
                    {step.name}
                  </b>
                  <small className="text-caption text-fg-faint">{step.sub}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {note ? (
        <div className="mt-2 flex gap-2.25 px-3 text-body-sm text-fg-dim">
          <Icon name="info" className="mt-0.5" />
          <span>{note}</span>
        </div>
      ) : null}
      <AuthWorkspaceLine workspace={workspace} plain />
    </aside>
  );
}

type AuthLayoutProps = React.ComponentProps<"div"> & { side: React.ReactNode };

function AuthLayout({ side, className, children, ...props }: AuthLayoutProps) {
  return (
    <div
      data-slot="auth-layout"
      className={cn("relative grid min-h-dvh grid-cols-[560px_1fr] bg-page", className)}
      {...props}
    >
      {side}
      <main className="grid place-items-center overflow-hidden p-8">{children}</main>
    </div>
  );
}

type AuthFormProps = React.ComponentProps<"div"> & {
  width?: "normal" | "wide" | "wizard";
  center?: boolean;
};

function AuthForm({ width = "normal", center = false, className, ...props }: AuthFormProps) {
  return (
    <div
      data-slot="auth-form"
      className={cn(
        "grid gap-3.5",
        width === "normal" && "w-100",
        width === "wide" && "w-117.5",
        width === "wizard" && "w-180 gap-4.5",
        center && "justify-items-center text-center [&>*]:w-full",
        className,
      )}
      {...props}
    />
  );
}

function AuthHeading({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div data-slot="auth-heading">
      <h2 className="m-0 text-display font-semibold tracking-[-0.01em] text-fg">{title}</h2>
      {children ? (
        <p className="mt-1.5 mb-0 text-body leading-[1.45] text-fg-dim">{children}</p>
      ) : null}
    </div>
  );
}

function AuthBadge({ icon }: { icon: IconName }) {
  return (
    <span className="mx-auto grid size-13 place-items-center text-fg-dim">
      <Icon name={icon} size="xl" />
    </span>
  );
}

function OrDivider({ children = "or" }: { children?: React.ReactNode }) {
  return (
    <div
      data-slot="or-divider"
      className="flex items-center gap-3 text-caption text-fg-faint before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line"
    >
      <span>{children}</span>
    </div>
  );
}

function AuthFoot({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="auth-foot"
      className={cn(
        "flex flex-wrap items-center justify-center gap-1.5 text-center text-body-sm text-fg-dim",
        className,
      )}
      {...props}
    />
  );
}

function AuthLink({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-pointer border-0 bg-transparent p-0 font-medium text-accent hover:underline",
        className,
      )}
      {...props}
    />
  );
}

function DotSeparator() {
  return (
    <span aria-hidden="true" className="text-fg-faint">
      ·
    </span>
  );
}

function SsoButton({
  workspace,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { workspace: AuthWorkspace }) {
  return (
    <Button className="h-10 w-full gap-2.5 text-body" {...props}>
      <WorkspaceLogo workspace={workspace} size={20} />
      {children}
    </Button>
  );
}

function AuthField({
  label,
  aside,
  children,
}: {
  label: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 text-left">
      <span className="flex items-baseline justify-between gap-2 text-caption font-semibold text-fg-dim">
        <span>{label}</span>
        {aside ? <span className="text-body-sm font-medium">{aside}</span> : null}
      </span>
      {children}
    </div>
  );
}

type PasswordMeterProps = React.ComponentProps<"div"> & {
  strength: 0 | 1 | 2 | 3 | 4;
  label: string;
};

function PasswordMeter({ strength, label, className, ...props }: PasswordMeterProps) {
  return (
    <div
      data-slot="password-meter"
      role="meter"
      aria-label="Password strength"
      aria-valuemin={0}
      aria-valuemax={4}
      aria-valuenow={strength}
      aria-valuetext={label}
      className={cn("-mt-1.5 flex items-center gap-2.5", className)}
      {...props}
    >
      <span className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((index) => (
          <i
            key={index}
            className={cn(
              "h-1 flex-1 rounded-xs bg-chrome-3",
              index < strength && (strength >= 3 ? "bg-ok" : "bg-warn"),
            )}
          />
        ))}
      </span>
      <small className="min-w-20 text-right text-caption text-fg-faint">{label}</small>
    </div>
  );
}

function RequirementList({ items }: { items: { text: string; met: boolean }[] }) {
  return (
    <ul className="-mt-1 m-0 grid list-none gap-1.25 p-0 text-body-sm text-fg-dim">
      {items.map((item) => (
        <li key={item.text} className="flex items-center gap-1.75">
          <Icon
            name={item.met ? "check" : "minus-circle"}
            className={item.met ? "text-ok" : undefined}
          />
          {item.text}
          <span className="sr-only">{item.met ? ", met" : ", not met"}</span>
        </li>
      ))}
    </ul>
  );
}

type CodeBoxesProps = React.ComponentProps<"div"> & { digits: string; length?: number };

function CodeBoxes({ digits, length = 6, className, ...props }: CodeBoxesProps) {
  return (
    <div
      data-slot="code-boxes"
      role="group"
      className={cn("flex justify-center gap-2", className)}
      {...props}
    >
      {Array.from({ length }, (_, index) => (
        <span
          key={index}
          className={cn(
            "grid h-13 w-11 place-items-center rounded-lg border border-line-strong bg-chrome font-mono text-page-title font-semibold text-fg",
            index === digits.length && "border-accent shadow-[0_0_0_3px_var(--accent-soft)]",
          )}
        >
          {digits[index] ?? ""}
        </span>
      ))}
    </div>
  );
}

type ChoiceTileProps = Omit<React.ComponentProps<"button">, "title"> & {
  icon: IconName;
  title: React.ReactNode;
  detail: React.ReactNode;
  selected: boolean;
  badge?: React.ReactNode;
  tall?: boolean;
};

function ChoiceTile({
  icon,
  title,
  detail,
  selected,
  badge,
  tall,
  className,
  ...props
}: ChoiceTileProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(
        "relative grid cursor-pointer content-start gap-1.25 rounded-[10px] border border-line bg-surf-field p-3.5 text-left text-fg hover:not-aria-checked:border-line-strong aria-checked:border-accent aria-checked:bg-surf-hl aria-checked:shadow-[inset_0_0_0_1px_var(--accent)]",
        tall && "min-h-37.5",
        className,
      )}
      {...props}
    >
      <Icon name={icon} />
      <b className="text-body">{title}</b>
      <small className="text-body-sm leading-[1.45] text-fg-dim">{detail}</small>
      {badge ? <span className="absolute top-3 right-2.5">{badge}</span> : null}
    </button>
  );
}

type ChoiceOptionProps = Omit<React.ComponentProps<"button">, "title"> & {
  lead: React.ReactNode;
  title: React.ReactNode;
  detail: React.ReactNode;
  selected: boolean;
  end?: React.ReactNode;
};

function ChoiceOption({
  lead,
  title,
  detail,
  selected,
  end,
  className,
  ...props
}: ChoiceOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.75 rounded-[10px] border border-line bg-surf-field px-3 py-2.5 text-left text-fg hover:not-aria-checked:border-line-strong aria-checked:border-accent aria-checked:bg-surf-hl aria-checked:shadow-[inset_0_0_0_1px_var(--accent)]",
        className,
      )}
      {...props}
    >
      {lead}
      <span className="min-w-0 flex-1">
        <b className="block text-body-sm">{title}</b>
        <small className="block text-caption text-fg-faint">{detail}</small>
      </span>
      {end}
    </button>
  );
}

type ChoiceIconProps = React.ComponentProps<"button"> & {
  icon: IconName;
  selected: boolean;
};

function ChoiceIcon({ icon, selected, className, children, ...props }: ChoiceIconProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(
        "grid cursor-pointer justify-items-center gap-1.5 rounded-[10px] border border-line bg-surf-field px-2 py-3 text-body-sm text-fg hover:not-aria-checked:border-line-strong aria-checked:border-accent aria-checked:bg-surf-hl aria-checked:shadow-[inset_0_0_0_1px_var(--accent)]",
        className,
      )}
      {...props}
    >
      <Icon name={icon} size="md" />
      {children}
    </button>
  );
}

function DeepLinkNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-accent-soft px-2.75 py-2 text-left text-body-sm text-fg">
      <Icon name="link" />
      <span>{children}</span>
    </div>
  );
}

type PasskeySheetProps = {
  kind: "touch" | "qr";
  person?: PersonInfo & { email: string };
  onContinue: () => void;
  onCancel: () => void;
  onOther?: () => void;
  onBack?: () => void;
  className?: string;
};

function QrCode() {
  const size = 25;
  const finder = (x: number, y: number) =>
    [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ].find(([a = 0, b = 0]) => x >= a && x < a + 7 && y >= b && y < b + 7);
  let seed = 7;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const corner = finder(x, y);
      const quiet = (x < 8 && y < 8) || (x > size - 9 && y < 8) || (x < 8 && y > size - 9);
      const dx = corner ? x - (corner[0] ?? 0) : 0;
      const dy = corner ? y - (corner[1] ?? 0) : 0;
      const on = corner
        ? dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)
        : !quiet && (seed >> 16) % 2 === 0;
      if (on) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code for signing in with a phone"
      className="size-30 rounded-md bg-white p-1.5"
    >
      <path d={path} fill="#111" />
    </svg>
  );
}

function PasskeySheet({
  kind,
  person,
  onContinue,
  onCancel,
  onOther,
  onBack,
  className,
}: PasskeySheetProps) {
  const title = kind === "qr" ? "Use a phone or security key" : "Use your passkey for parfocal.eu";
  return (
    <div
      role="dialog"
      aria-label={title}
      data-slot="passkey-sheet"
      className={cn(
        "absolute top-4.5 left-1/2 z-40 grid w-100 -translate-x-1/2 gap-3.5 rounded-xl border border-line bg-chrome p-4.5 text-left font-sans shadow-pop",
        className,
      )}
    >
      <StatusTag tone="research" className="justify-self-start">
        The browser's own window · mocked
      </StatusTag>
      <div className="flex items-center gap-2 text-caption text-fg-faint">
        <Icon name="key" />
        <span>parfocal.eu</span>
      </div>
      <b className="text-lead font-semibold text-fg">{title}</b>
      {kind === "qr" ? (
        <div className="grid grid-cols-[auto_1fr] items-center gap-4 text-body-sm leading-[1.45] text-fg-dim">
          <QrCode />
          <div className="grid gap-2">
            <p className="m-0">
              Scan this with the phone or tablet that has your passkey for parfocal.eu.
            </p>
            <p className="m-0">Or plug in your security key and touch it.</p>
            <span>Waiting for your phone or key…</span>
          </div>
        </div>
      ) : (
        <>
          {person ? (
            <div className="rounded-lg bg-chrome-2 px-3 py-2.5">
              <Person person={person} size={28} sub={person.email} />
            </div>
          ) : null}
          <div className="flex items-center gap-3 text-body-sm leading-[1.45] text-fg-dim">
            <Icon name="key" />
            <span>
              Touch ID, or your computer's PIN, unlocks the passkey saved on this computer.
            </span>
          </div>
        </>
      )}
      <div className="flex items-center gap-2 text-body-sm">
        {kind === "qr" ? (
          onBack ? (
            <AuthLink onClick={onBack}>Back</AuthLink>
          ) : null
        ) : onOther ? (
          <AuthLink onClick={onOther}>Use a phone or security key</AuthLink>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {kind === "qr" ? (
          <Button size="sm" variant="primary" onClick={onContinue}>
            The phone answered
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onContinue}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

type LockCardProps = {
  person: PersonInfo;
  minutes: number;
  onUnlock: () => void;
  onPasskey: () => void;
  onLogOut: () => void;
};

function LockCard({ person, minutes, onUnlock, onPasskey, onLogOut }: LockCardProps) {
  const first = person.name.split(" ")[0] ?? person.name;
  return (
    <div
      data-slot="lock-card"
      className="absolute inset-0 z-25 grid place-items-center bg-[color-mix(in_srgb,var(--page)_55%,transparent)] backdrop-blur-[22px] backdrop-saturate-[.6]"
    >
      <section
        aria-label="Locked"
        className="flex w-90 flex-col items-center gap-3.5 rounded-xl border border-line bg-chrome p-7 text-center"
      >
        <PersonAvatar person={person} size={56} />
        <div>
          <b className="text-title-sm text-fg">{person.name}</b>
          <div className="text-body-sm text-fg-dim">
            Locked after {minutes} minutes without input
          </div>
        </div>
        <form
          className="grid w-full gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onUnlock();
          }}
        >
          <label className="sr-only" htmlFor="lock-password">
            Password
          </label>
          <span className="flex h-9 items-center gap-2 rounded-ctl border border-line bg-surf-field px-2.5 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
            <Icon name="lock" className="text-fg-faint" />
            <input
              id="lock-password"
              type="password"
              placeholder="Password"
              className="min-w-0 flex-1 border-0 bg-transparent text-body-sm text-fg outline-none"
            />
          </span>
          <Button type="submit" variant="primary" className="w-full">
            Unlock
          </Button>
          <Button type="button" className="w-full" onClick={onPasskey}>
            <Icon name="key" />
            Unlock with a passkey
          </Button>
        </form>
        <span className="text-body-sm text-fg-dim">
          Not {first}? <AuthLink onClick={onLogOut}>Log out</AuthLink>, {first}'s work is saved.
        </span>
      </section>
    </div>
  );
}

export {
  AuthBadge,
  AuthField,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLayout,
  AuthLink,
  AuthPitchSide,
  type AuthStep,
  AuthStepsSide,
  type AuthWorkspace,
  ChoiceIcon,
  ChoiceOption,
  ChoiceTile,
  CodeBoxes,
  DeepLinkNote,
  DotSeparator,
  LockCard,
  OrDivider,
  PasskeySheet,
  PasswordMeter,
  RequirementList,
  SsoButton,
  WorkspaceLogo,
};
