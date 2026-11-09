import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type ModelOption = {
  id: string;
  title: string;
  description: string;
  makes: string[];
  perSlide: string;
  offline?: boolean;
};

type ModelGroup = { title: string; options: ModelOption[] };

function ModelChips({ makes, className }: { makes: string[]; className?: string }) {
  return (
    <span data-slot="model-chips" className={cn("inline-flex flex-wrap gap-1", className)}>
      {makes.map((item) => (
        <span
          key={item}
          className="inline-flex h-5 items-center rounded-full bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] px-1.75 text-caption whitespace-nowrap text-fg-dim"
        >
          {item}
        </span>
      ))}
    </span>
  );
}

function ModelTitle({
  option,
}: {
  option: Pick<ModelOption, "title" | "description" | "offline">;
}) {
  return (
    <span className="min-w-0">
      <b className="block text-body font-semibold text-fg">{option.title}</b>
      <small className="mt-px block text-body-sm leading-[1.45] text-fg-dim">
        {option.offline ? "Offline. Its server is not answering." : option.description}
      </small>
    </span>
  );
}

type ModelPickerProps = {
  id?: string;
  groups: ModelGroup[];
  value: string | null;
  onValueChange: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  footer?: React.ReactNode;
  note?: React.ReactNode;
  invalid?: boolean;
  className?: string;
};

function ModelPicker({
  id,
  groups,
  value,
  onValueChange,
  open,
  onOpenChange,
  footer,
  note,
  invalid = false,
  className,
}: ModelPickerProps) {
  const chosen = groups.flatMap((group) => group.options).find((option) => option.id === value);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger
        id={id}
        data-slot="model-picker"
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        className={cn(
          "grid min-h-13 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-ctl border border-line bg-surf-field px-3 py-2 text-left font-[inherit] text-fg hover:border-line-strong focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent data-popup-open:border-accent",
          invalid && "border-bad",
          className,
        )}
      >
        {chosen ? (
          <>
            <ModelTitle option={chosen} />
            <ModelChips makes={chosen.makes} />
          </>
        ) : (
          <>
            <b className="text-body font-semibold">Pick a model</b>
            <span />
          </>
        )}
        <Icon name="down" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          className="isolate z-60 w-(--anchor-width)"
        >
          <PopoverPrimitive.Popup
            role="listbox"
            aria-label="Models"
            className="grid gap-px rounded-zone border border-line-strong bg-popover p-1.5 text-body-sm text-fg shadow-[0_18px_48px_rgba(0,0,0,.45)] outline-hidden"
          >
            {groups.map((group) => (
              <div key={group.title} className="grid gap-px">
                <div className="px-2.5 pt-2 pb-1 text-caption font-semibold text-fg-dim">
                  {group.title}
                </div>
                {group.options.map((option) => {
                  const on = option.id === value;
                  return (
                    <div
                      key={option.id}
                      role="option"
                      tabIndex={0}
                      aria-selected={on}
                      aria-disabled={option.offline || undefined}
                      onClick={() => {
                        if (option.offline) return;
                        onValueChange(option.id);
                        onOpenChange(false);
                      }}
                      onKeyDown={(event) => {
                        if (!option.offline && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          onValueChange(option.id);
                          onOpenChange(false);
                        }
                      }}
                      className={cn(
                        "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_104px_16px] items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-[color-mix(in_srgb,var(--fg)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent",
                        on && "bg-surf-hl",
                        option.offline && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <ModelTitle option={option} />
                      <ModelChips makes={option.makes} />
                      <span className="text-right text-caption whitespace-nowrap text-fg-dim">
                        {option.offline ? "offline" : option.perSlide}
                      </span>
                      {on ? <Icon name="check" className="text-accent" /> : <span />}
                    </div>
                  );
                })}
              </div>
            ))}
            {footer ? (
              <div className="mt-1 border-t border-line pt-1 text-body-sm text-accent">
                {footer}
              </div>
            ) : null}
            {note ? (
              <div className="px-2.5 pt-0.5 pb-1.5 text-body-sm leading-[1.45] text-fg-dim">
                {note}
              </div>
            ) : null}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

type OutcomeRowProps = Omit<React.ComponentProps<"div">, "title"> & {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: React.ReactNode;
  detail?: React.ReactNode;
};

function OutcomeRow({ icon, title, detail, className, ...props }: OutcomeRowProps) {
  return (
    <div
      data-slot="outcome-row"
      className={cn("grid grid-cols-[16px_minmax(0,1fr)] items-start gap-3", className)}
      {...props}
    >
      <Icon name={icon} className="mt-0.5 text-fg-dim" />
      <span>
        <b className="block text-body-sm font-semibold text-fg">{title}</b>
        {detail ? (
          <small className="mt-0.5 block text-body-sm leading-[1.45] text-fg-dim">{detail}</small>
        ) : null}
      </span>
    </div>
  );
}

export {
  ModelChips,
  type ModelGroup,
  type ModelOption,
  ModelPicker,
  type ModelPickerProps,
  OutcomeRow,
  type OutcomeRowProps,
};
