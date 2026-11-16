import { Trans, useLingui } from "@lingui/react/macro";
import { InlineState } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type { ReactNode } from "react";
import { type Camera, readout, type StillView } from "./slide-still.tsx";

export function CameraBar({
  view,
  shown,
  moved,
  showDone,
  confirmRest,
  currentId,
  onCamera,
  onBack,
  onWhole,
}: {
  view: StillView;
  shown: Camera;
  moved: boolean;
  showDone: boolean;
  confirmRest: boolean;
  currentId: string;
  onCamera: (camera: Camera) => void;
  onBack: () => void;
  onWhole: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-2">
      {showDone ? null : (
        <Button
          size="lg"
          variant={moved && !confirmRest ? "primary" : "secondary"}
          title={t`Center ${currentId} again`}
          onClick={onBack}
        >
          <Icon name="target" />
          <Trans>Back to {currentId}</Trans>
        </Button>
      )}
      <fieldset
        aria-label={t`Zoom`}
        className="m-0 inline-flex h-10 min-w-0 items-center rounded-ctl border border-line-strong bg-btn-bg p-0"
      >
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={t`Zoom out`}
          title={t`Zoom out (−)`}
          onClick={() => onCamera({ ...shown, scale: shown.scale / 1.4 })}
        >
          <Icon name="minus" />
        </Button>
        <span
          className="min-w-14 text-center font-mono text-body-sm font-semibold"
          title={t`Magnification on screen`}
        >
          {readout(view, shown)}
        </span>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={t`Zoom in`}
          title={t`Zoom in (+)`}
          onClick={() => onCamera({ ...shown, scale: shown.scale * 1.4 })}
        >
          <Icon name="plus" />
        </Button>
      </fieldset>
      <Button
        size="lg"
        className={
          view.kind === "whole"
            ? "border-accent bg-[color-mix(in_srgb,var(--accent)_18%,var(--chrome))]"
            : undefined
        }
        aria-pressed={view.kind === "whole"}
        title={view.kind === "whole" ? t`Back to ${currentId}` : t`See the whole slide`}
        onClick={onWhole}
      >
        <Icon name="expand" />
        <Trans>Whole slide</Trans>
      </Button>
    </div>
  );
}

export function CoachTip({
  n,
  children,
  className,
}: {
  n: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-zone bg-[#0369a1] px-3.5 py-3 text-body-sm leading-[1.45] text-white shadow-pop",
        className,
      )}
    >
      <b className="grid size-5.5 shrink-0 place-items-center rounded-full bg-white text-caption text-[#0369a1]">
        {n}
      </b>
      <span>{children}</span>
    </div>
  );
}

export function IssueCard({
  icon,
  title,
  body,
  action,
}: {
  icon: "info" | "smart";
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div className="grid justify-items-start gap-3">
      <Icon name={icon} size="lg" className="text-fg-dim" />
      <h2 className="m-0 text-title-sm font-semibold">{title}</h2>
      <p className="m-0 text-body leading-[1.5] text-fg-dim">{body}</p>
      {action}
    </div>
  );
}

export function CanvasNotice({
  icon,
  title,
  actions,
  children,
}: {
  icon: "warn" | "smart" | "info";
  title: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="absolute top-4 left-1/2 w-[min(760px,calc(100%-2rem))] -translate-x-1/2">
      <InlineState
        icon={icon}
        title={title}
        action={<span className="flex gap-2">{actions}</span>}
        className="border-solid shadow-pop"
      >
        {children}
      </InlineState>
    </div>
  );
}
