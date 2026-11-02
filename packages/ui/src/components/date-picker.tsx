import { Calendar } from "@parfocal/ui/components/calendar";
import { Icon } from "@parfocal/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@parfocal/ui/components/popover";
import { cn } from "@parfocal/ui/lib/utils";
import { useState } from "react";

type DatePickerProps = {
  value?: string;
  onValueChange?: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  today?: string;
  defaultOpen?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
};

function parseDay(value: string | undefined) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function formatDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const shownDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function DatePicker({
  value,
  onValueChange,
  min,
  max,
  placeholder = "Pick a date",
  disabled = false,
  invalid = false,
  today,
  defaultOpen = false,
  id,
  className,
  ...props
}: DatePickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const selected = parseDay(value);
  const minDay = parseDay(min);
  const maxDay = parseDay(max);
  const todayDay = parseDay(today);
  const month = selected ?? todayDay ?? minDay;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-label={props["aria-label"]}
        data-slot="date-picker"
        data-empty={selected ? undefined : true}
        className={cn(
          "flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-ctl border border-line-strong bg-surf-field px-2.5 text-left text-body-sm text-fg outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-bad data-empty:text-fg-faint",
          className,
        )}
      >
        <span className="inline-flex items-center gap-2">
          <Icon name="calendar" size="sm" className="text-fg-dim" />
          {selected ? shownDate.format(selected) : placeholder}
        </span>
        <Icon name="down" size="sm" className="text-fg-faint" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          {...(selected ? { selected } : {})}
          {...(month ? { defaultMonth: month } : {})}
          {...(todayDay ? { today: todayDay } : {})}
          disabled={[
            ...(minDay ? [{ before: minDay }] : []),
            ...(maxDay ? [{ after: maxDay }] : []),
          ]}
          onSelect={(date) => {
            if (!date) return;
            onValueChange?.(formatDay(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker, type DatePickerProps };
