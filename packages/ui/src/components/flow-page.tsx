import type { LinkRenderer } from "@parfocal/ui/components/app-shell";
import { Icon } from "@parfocal/ui/components/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@parfocal/ui/components/tooltip";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type Crumb = { label: string; href?: string };

const anchorLink: LinkRenderer = ({ children, ...props }) => <a {...props}>{children}</a>;

function Breadcrumbs({
  items,
  className,
  renderLink = anchorLink,
}: {
  items: Crumb[];
  className?: string | undefined;
  renderLink?: LinkRenderer | undefined;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex min-h-6 flex-wrap items-center gap-1.5 text-body-sm text-fg-faint",
        className,
      )}
    >
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

type FlowStep = { label: string; state?: StepState; why?: string };

type StepperProps = Omit<React.ComponentProps<"ol">, "onSelect"> & {
  steps: FlowStep[];
  current: number;
  onStepSelect?: (index: number) => void;
};

function stepState(step: FlowStep, index: number, current: number): StepState {
  return step.state ?? (index === current ? "current" : index < current ? "done" : "todo");
}

function Stepper({ steps, current, onStepSelect, className, ...props }: StepperProps) {
  return (
    <ol
      data-slot="stepper"
      aria-label="Steps"
      className={cn(
        "m-0 flex list-none flex-wrap items-center gap-2.5 p-0 text-body-sm text-fg-dim",
        className,
      )}
      {...props}
    >
      {steps.map((step, index) => {
        const state = stepState(step, index, current);
        const reachable = state === "done" || state === "warn";
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
        return (
          <li key={step.label} className="inline-flex items-center gap-2.5">
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
                className="inline-flex cursor-pointer items-center gap-1.75 rounded-sm border-0 bg-transparent p-0 text-body-sm text-fg-dim hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
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
                      className="inline-flex cursor-not-allowed items-center gap-1.75 rounded-sm border-0 bg-transparent p-0 text-body-sm text-fg-dim focus-visible:outline-2 focus-visible:outline-accent"
                    />
                  }
                >
                  {mark}
                  {step.label}
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

type FlowPageProps = Omit<React.ComponentProps<"div">, "title"> & {
  crumbs: Crumb[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  steps: FlowStep[];
  current: number;
  onStepSelect?: (index: number) => void;
  bar: React.ReactNode;
  moreBelow?: boolean;
  status?: React.ReactNode;
  renderLink?: LinkRenderer | undefined;
};

function FlowPage({
  crumbs,
  title,
  subtitle,
  steps,
  current,
  onStepSelect,
  bar,
  moreBelow = false,
  status,
  renderLink,
  className,
  children,
  ...props
}: FlowPageProps) {
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
          <Breadcrumbs items={crumbs} className="mb-2" renderLink={renderLink} />
          <h2 className="m-0 text-page-title leading-[1.25] font-semibold">{title}</h2>
          {subtitle ? (
            <p className="mt-1 mb-4 text-body-sm leading-[1.45] text-fg-dim">{subtitle}</p>
          ) : (
            <div className="h-4" />
          )}
          {status ?? (
            <Stepper steps={steps} current={current} {...(onStepSelect ? { onStepSelect } : {})} />
          )}
        </div>
      </header>
      <div className="min-h-0 overflow-auto">
        <div className="mx-auto grid w-full max-w-208 grid-cols-[minmax(0,760px)] justify-center px-9 pt-6 pb-10">
          <div className="grid min-w-0 gap-5">{children}</div>
        </div>
      </div>
      <div
        className={cn(
          "sticky bottom-0 border-t border-line bg-surf-panel",
          moreBelow && "shadow-[0_-8px_16px_-8px_rgb(0_0_0/0.35)]",
        )}
      >
        <div className="mx-auto w-full max-w-208 px-9">{bar}</div>
      </div>
    </div>
  );
}

type FlowBarProps = React.ComponentProps<"div"> & {
  back?: React.ReactNode;
  hint?: React.ReactNode;
  next: React.ReactNode;
  blockers?: React.ReactNode;
};

function FlowBar({ back, hint, next, blockers, className, ...props }: FlowBarProps) {
  return (
    <div data-slot="flow-bar" className={cn("grid", className)} {...props}>
      {blockers ? <div className="pt-3.5">{blockers}</div> : null}
      <div className="flex items-center gap-3 py-3">
        {back}
        <span className="min-w-0 flex-1 text-body-sm leading-[1.45] text-fg-dim">{hint}</span>
        {next}
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
  type FlowStep,
  Stepper,
  type StepperProps,
  type StepState,
  SummaryRows,
  type SummaryRowsProps,
};
