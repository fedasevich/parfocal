import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type BannerTone = "warn" | "info" | "bad";

const bannerTones: Record<BannerTone, string> = {
  warn: "bg-[color-mix(in_srgb,var(--warn)_16%,var(--chrome))] [&>svg]:text-warn",
  info: "bg-[color-mix(in_srgb,var(--accent)_14%,var(--chrome))] [&>svg]:text-accent",
  bad: "bg-[color-mix(in_srgb,var(--bad)_16%,var(--chrome))] [&>svg]:text-bad",
};

type BannerProps = React.ComponentProps<"div"> & {
  tone?: BannerTone;
  icon?: IconName;
  actions?: React.ReactNode;
  inline?: boolean;
};

function Banner({
  tone = "warn",
  icon,
  actions,
  inline = false,
  className,
  children,
  ...props
}: BannerProps) {
  return (
    <div
      data-slot="banner"
      data-tone={tone}
      role={tone === "info" ? "status" : "alert"}
      className={cn(
        "flex items-center gap-2.5 text-body-sm text-fg",
        inline ? "rounded-zone px-4 py-3" : "min-h-10 border-b border-line px-4",
        bannerTones[tone],
        className,
      )}
      {...props}
    >
      <Icon name={icon ?? (tone === "info" ? "info" : "warn")} />
      <span className="min-w-0 flex-1">{children}</span>
      {actions ? <span className="flex shrink-0 items-center gap-2">{actions}</span> : null}
    </div>
  );
}

type InlineErrorProps = React.ComponentProps<"div"> & {
  actions?: React.ReactNode;
  tone?: "bad" | "warn";
};

function InlineError({ actions, tone = "bad", className, children, ...props }: InlineErrorProps) {
  return (
    <div
      data-slot="inline-error"
      role="alert"
      className={cn("grid gap-1 text-body-sm leading-[1.45]", className)}
      {...props}
    >
      <p className={cn("m-0 flex gap-1.5", tone === "bad" ? "text-bad" : "text-warn")}>
        <Icon name="warn" className="mt-0.5" />
        <span>{children}</span>
      </p>
      {actions ? <div className="flex flex-wrap gap-4 pl-5.5">{actions}</div> : null}
    </div>
  );
}

type InlineStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  icon?: IconName;
  title: React.ReactNode;
  action?: React.ReactNode;
};

function InlineState({
  icon = "info",
  title,
  action,
  className,
  children,
  ...props
}: InlineStateProps) {
  return (
    <div
      data-slot="inline-state"
      className={cn(
        "grid grid-cols-[22px_1fr_auto] items-center gap-3.5 rounded-zone border border-dashed border-line-strong bg-chrome px-4.5 py-4",
        className,
      )}
      {...props}
    >
      <Icon name={icon} size="lg" className="text-fg-dim" />
      <div>
        <b className="block text-body">{title}</b>
        {children ? (
          <span className="mt-0.5 block text-body-sm text-fg-dim">{children}</span>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export {
  Banner,
  type BannerProps,
  type BannerTone,
  InlineError,
  type InlineErrorProps,
  InlineState,
  type InlineStateProps,
};
