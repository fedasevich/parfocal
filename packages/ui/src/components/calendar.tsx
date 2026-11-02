import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import { enGB } from "react-day-picker/locale";

function CalendarChevron({ orientation }: { orientation?: "left" | "right" | "up" | "down" }) {
  const name = orientation === "left" ? "back" : orientation === "right" ? "next" : "down";
  return <Icon name={name} size="sm" />;
}

function Calendar({ className, classNames, showOutsideDays = true, ...props }: DayPickerProps) {
  return (
    <DayPicker
      data-slot="calendar"
      locale={enGB}
      weekStartsOn={1}
      showOutsideDays={showOutsideDays}
      className={cn("w-fit p-1", className)}
      classNames={{
        root: "relative w-fit",
        months: "flex flex-col",
        month: "grid gap-2",
        month_caption:
          "flex h-8 items-center justify-center px-9 text-body-sm font-semibold text-fg",
        caption_label: "select-none",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous:
          "grid size-8 cursor-pointer place-items-center rounded-ctl border-0 bg-transparent p-0 text-fg-dim hover:bg-chrome-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
        button_next:
          "grid size-8 cursor-pointer place-items-center rounded-ctl border-0 bg-transparent p-0 text-fg-dim hover:bg-chrome-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
        month_grid: "border-collapse",
        weekdays: "",
        weekday: "size-8 text-center text-caption font-medium text-fg-dim",
        week: "",
        day: "size-8 p-0 text-center text-body-sm",
        day_button:
          "grid size-8 cursor-pointer place-items-center rounded-ctl border border-transparent bg-transparent p-0 text-fg hover:bg-chrome-2 focus-visible:outline-2 focus-visible:outline-accent",
        selected:
          "[&>button]:bg-accent-fill [&>button]:text-on-accent [&>button:hover]:bg-accent-fill",
        today: "[&>button]:border-accent [&>button]:font-semibold",
        outside: "[&>button]:text-fg-faint",
        disabled:
          "[&>button]:cursor-not-allowed [&>button]:opacity-35 [&>button:hover]:bg-transparent",
        hidden: "invisible",
        ...classNames,
      }}
      components={{ Chevron: CalendarChevron }}
      {...props}
    />
  );
}

export { Calendar, type DayPickerProps as CalendarProps };
