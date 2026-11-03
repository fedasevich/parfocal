import type { LinkRenderer } from "@parfocal/ui/components/app-shell";
import {
  BeforeYouList,
  type Blocker,
  blockerReason,
} from "@parfocal/ui/components/before-you-list";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { Tooltip, TooltipContent, TooltipTrigger } from "@parfocal/ui/components/tooltip";
import { cn } from "@parfocal/ui/lib/utils";
import * as React from "react";

type Crumb = { label: string; href?: string };

const anchorLink: LinkRenderer = ({ children, ...props }) => <a {...props}>{children}</a>;

function Breadcrumbs({
  items,
  className,
  renderLink = anchorLink,
  start,
}: {
  items: Crumb[];
  className?: string | undefined;
  renderLink?: LinkRenderer | undefined;
  start?: React.ReactNode;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex min-h-6 flex-wrap items-center gap-1.5 text-body-sm text-fg-faint",
        className,
      )}
    >
      {start}
      {items.map((item, index) =>
        index === items.length - 1 ? (
          <span key={item.label} aria-current="page" className="text-fg">
            {item.label}
          </span>
        ) : (
          <span key={item.label} className="inline-flex items-center gap-1.5">
            {renderLink({
              href: item.href ?? "#",
              className: "text-fg-dim no-underline hover:text-fg hover:underline",
              children: item.label,
            })}
            <span aria-hidden="true">/</span>
          </span>
        ),
      )}
    </nav>
  );
}

type StepState = "done" | "current" | "todo" | "warn";

type FlowStep = { label: string; state?: StepState; why?: string; locked?: boolean };

type StepperProps = Omit<React.ComponentProps<"ol">, "onSelect"> & {
  steps: FlowStep[];
  current: number;
  reached?: number;
  onStepSelect?: (index: number) => void;
};

function stepState(step: FlowStep, index: number, current: number, reached: number): StepState {
  if (step.state) return step.state;
  if (index === current) return "current";
  return index <= reached ? "done" : "todo";
}

function stepReachable(step: FlowStep, state: StepState, index: number, reached: number) {
  if (step.locked || state === "current") return false;
  return state === "done" || state === "warn" || index <= reached;
}

const stepButton =
  "inline-flex items-center gap-1.75 rounded-sm border-0 bg-transparent p-0 text-body-sm text-fg-dim focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

function moveStepFocus(event: React.KeyboardEvent<HTMLOListElement>) {
  const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0 || buttons.length === 0) return;
  event.preventDefault();
  const last = buttons.length - 1;
  const to =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowRight"
          ? Math.min(last, at + 1)
          : Math.max(0, at - 1);
  buttons[to]?.focus();
}

function Stepper({
  steps,
  current,
  reached = current,
  onStepSelect,
  className,
  ...props
}: StepperProps) {
  const id = React.useId();
  const furthest = Math.max(reached, current);
  return (
    <ol
      data-slot="stepper"
      aria-label="Steps"
      onKeyDown={moveStepFocus}
      className={cn(
        "m-0 flex list-none flex-wrap items-center gap-2.5 p-0 text-body-sm text-fg-dim",
        className,
      )}
      {...props}
    >
      {steps.map((step, index) => {
        const state = stepState(step, index, current, furthest);
        const reachable = stepReachable(step, state, index, furthest);
        const mark = (
          <i
            className={cn(
              "grid size-5.5 place-items-center rounded-full font-sans text-label font-semibold not-italic",
              state === "done" && "bg-ok text-on-ok",
              state === "current" && "bg-accent-fill text-on-accent",
              state === "warn" && "bg-warn text-on-ok",
              state === "todo" && "bg-chrome-3 text-fg-dim",
            )}
          >
            {state === "done" ? <Icon name="check" size="xs" /> : index + 1}
          </i>
        );
        const why =
          step.why ??
          `Not reached yet. Finish ${steps[current]?.label ?? "this step"} first, then use Next.`;
        const whyId = `${id}-why-${index}`;
        return (
          <li
            key={step.label}
            data-state={state}
            data-reachable={reachable || undefined}
            className="inline-flex items-center gap-2.5"
          >
            {index > 0 ? <em aria-hidden="true" className="h-px w-7 bg-line-strong" /> : null}
            {state === "current" ? (
              <span
                aria-current="step"
                className="inline-flex items-center gap-1.75 font-semibold text-fg"
              >
                {mark}
                {step.label}
              </span>
            ) : reachable ? (
              <button
                type="button"
                title={step.why}
                onClick={() => onStepSelect?.(index)}
                className={cn(stepButton, "cursor-pointer hover:text-fg")}
              >
                {mark}
                {step.label}
              </button>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-disabled="true"
                      aria-describedby={whyId}
                      className={cn(stepButton, "cursor-not-allowed")}
                    />
                  }
                >
                  {mark}
                  {step.label}
                  <span id={whyId} className="sr-only">
                    {why}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{why}</TooltipContent>
              </Tooltip>
            )}
          </li>
        );
      })}
    </ol>
  );
}

type FlowProgress = { current: number; reached: number };

function useFlowSteps(count: number, initial: Partial<FlowProgress> = {}) {
  const [progress, setProgress] = React.useState<FlowProgress>(() => {
    const current = Math.min(Math.max(initial.current ?? 0, 0), count - 1);
    return { current, reached: Math.min(Math.max(initial.reached ?? current, current), count - 1) };
  });
  const go = React.useCallback(
    (index: number) =>
      setProgress((now) => {
        if (index < 0 || index >= count || index > now.reached + 1) return now;
        return { current: index, reached: Math.max(now.reached, index) };
      }),
    [count],
  );
  return {
    ...progress,
    progress,
    first: progress.current === 0,
    last: progress.current === count - 1,
    go,
    next: () => go(progress.current + 1),
    back: () => go(progress.current - 1),
  };
}

function useScrollState() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState({ more: false, overflows: false });
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const overflows = node.scrollHeight > node.clientHeight + 1;
      const more = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
      setState((now) =>
        now.more === more && now.overflows === overflows ? now : { more, overflows },
      );
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);
  return [ref, state] as const;
}

type FlowPageProps = Omit<React.ComponentProps<"div">, "title"> & {
  crumbs: Crumb[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  steps: FlowStep[];
  current: number;
  reached?: number;
  onStepSelect?: (index: number) => void;
  bar: React.ReactNode;
  moreBelow?: boolean;
  status?: React.ReactNode;
  renderLink?: LinkRenderer | undefined;
  crumbStart?: React.ReactNode;
};

function FlowPage({
  crumbs,
  title,
  subtitle,
  steps,
  current,
  reached,
  onStepSelect,
  bar,
  moreBelow,
  status,
  renderLink,
  crumbStart,
  className,
  children,
  ...props
}: FlowPageProps) {
  const [scrollRef, scroll] = useScrollState();
  const more = moreBelow ?? scroll.more;
  return (
    <div
      data-slot="flow-page"
      className={cn(
        "grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-surf-page text-fg",
        className,
      )}
      {...props}
    >
      <header className="border-b border-line pt-5 pb-4.5">
        <div className="mx-auto w-full max-w-208 px-9">
          <Breadcrumbs items={crumbs} className="mb-2" renderLink={renderLink} start={crumbStart} />
          <h2 className="m-0 text-page-title leading-[1.25] font-semibold">{title}</h2>
          {subtitle ? (
            <p className="mt-1 mb-4 text-body-sm leading-[1.45] text-fg-dim">{subtitle}</p>
          ) : (
            <div className="h-4" />
          )}
          {status ?? (
            <Stepper
              steps={steps}
              current={current}
              {...(reached === undefined ? {} : { reached })}
              {...(onStepSelect ? { onStepSelect } : {})}
            />
          )}
        </div>
      </header>
      <div
        ref={scrollRef}
        data-slot="flow-body"
        {...(scroll.overflows ? { tabIndex: 0, role: "region", "aria-label": "Step content" } : {})}
        className="min-h-0 overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-accent"
      >
        <div className="mx-auto grid w-full max-w-208 grid-cols-[minmax(0,760px)] justify-center px-9 pt-6 pb-10">
          <div className="grid min-w-0 gap-5">{children}</div>
        </div>
      </div>
      <div
        data-slot="flow-bar-dock"
        data-more-below={more || undefined}
        className={cn(
          "sticky bottom-0 border-t border-line bg-surf-panel",
          more && "shadow-[0_-8px_16px_-8px_rgb(0_0_0/0.35)]",
        )}
      >
        <div className="mx-auto w-full max-w-208 px-9">{bar}</div>
      </div>
    </div>
  );
}

type FlowPrimary = {
  label: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  reason?: string;
  blockers?: Blocker[];
  blockersTitle?: string;
};

type FlowBarProps = React.ComponentProps<"div"> & {
  back?: React.ReactNode;
  hint?: React.ReactNode;
  next?: React.ReactNode;
  primary?: FlowPrimary;
  blockers?: React.ReactNode;
};

function FlowPrimaryButton({
  primary,
  describedBy,
}: {
  primary: FlowPrimary;
  describedBy?: string;
}) {
  const off = Boolean(primary.disabled) || (primary.blockers?.length ?? 0) > 0;
  return (
    <Button
      variant="primary"
      disabled={off}
      aria-describedby={off ? describedBy : undefined}
      onClick={primary.onClick}
    >
      {primary.label}
      <Keycap keys="↵" size="sm" />
    </Button>
  );
}

function FlowBar({ back, hint, next, primary, blockers, className, ...props }: FlowBarProps) {
  const id = React.useId();
  const list = primary?.blockers ?? [];
  const reason = primary ? (primary.reason ?? blockerReason(list)) : undefined;
  const listId = `${id}-list`;
  const reasonId = `${id}-reason`;
  const describedBy = list.length > 1 ? listId : reason ? reasonId : undefined;
  const top =
    list.length > 1 ? (
      <BeforeYouList
        id={listId}
        blockers={list}
        {...(primary?.blockersTitle ? { title: primary.blockersTitle } : {})}
      />
    ) : (
      blockers
    );
  return (
    <div data-slot="flow-bar" className={cn("grid", className)} {...props}>
      {top ? <div className="pt-3.5">{top}</div> : null}
      <div className="flex items-center gap-3 py-3">
        {back}
        <span className="min-w-0 flex-1 text-body-sm leading-[1.45] text-fg-dim">
          {reason ? <span id={reasonId}>{reason}</span> : hint}
        </span>
        {primary ? (
          <FlowPrimaryButton primary={primary} {...(describedBy ? { describedBy } : {})} />
        ) : (
          next
        )}
      </div>
    </div>
  );
}

type SummaryRowsProps = React.ComponentProps<"dl"> & {
  rows: Array<{ label: string; value: React.ReactNode; onChange?: () => void }>;
};

function SummaryRows({ rows, className, ...props }: SummaryRowsProps) {
  return (
    <dl
      data-slot="summary-rows"
      className={cn(
        "m-0 grid grid-cols-[168px_minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 text-body-sm leading-[1.45]",
        className,
      )}
      {...props}
    >
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-fg-dim">{row.label}</dt>
          <dd className="m-0 min-w-0 text-fg">{row.value}</dd>
          <dd className="m-0">
            <button
              type="button"
              onClick={row.onChange}
              aria-label={`Change ${row.label}`}
              className="cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline"
            >
              Change
            </button>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export {
  Breadcrumbs,
  type Crumb,
  FlowBar,
  type FlowBarProps,
  FlowPage,
  type FlowPageProps,
  type FlowPrimary,
  type FlowProgress,
  type FlowStep,
  Stepper,
  type StepperProps,
  type StepState,
  SummaryRows,
  type SummaryRowsProps,
  useFlowSteps,
};
