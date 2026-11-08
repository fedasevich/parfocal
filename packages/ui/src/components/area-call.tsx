import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import { type AreaCall, areaCalls } from "@parfocal/ui/lib/area-call";
import { cn } from "@parfocal/ui/lib/utils";
import { useEffect } from "react";

const callIcon: Record<AreaCall, IconName> = {
  tumor: "check",
  not: "x-circle",
  unsure: "help",
};

const callTone: Record<AreaCall, string> = {
  tumor: "text-ok",
  not: "text-bad",
  unsure: "text-warn",
};

type AreaCallProps = {
  area: string;
  value: AreaCall | null;
  onCall: (call: AreaCall) => void;
  disabled?: boolean;
  enterForTumor?: boolean;
  className?: string;
};

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest("input, textarea, select, button, a, [role=dialog], [role=menu]") !== null);

export function AreaCallButtons({
  area,
  value,
  onCall,
  disabled = false,
  enterForTumor = true,
  className,
}: AreaCallProps) {
  useEffect(() => {
    if (!enterForTumor || disabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || typing(event.target)) return;
      event.preventDefault();
      onCall("tumor");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enterForTumor, disabled, onCall]);
  return (
    <div
      data-slot="area-call"
      role="group"
      aria-label={`Your call on ${area}`}
      className={cn("grid grid-cols-3 gap-2", className)}
    >
      {areaCalls.map(({ call, label, key }) => (
        <button
          key={call}
          type="button"
          aria-pressed={value === call}
          disabled={disabled}
          data-call={call}
          onClick={() => onCall(call)}
          className="inline-flex h-11.5 cursor-pointer items-center justify-center gap-2 rounded-ctl border-[1.5px] border-line-strong bg-chrome-2 px-2 font-semibold text-fg text-lead outline-none hover:not-disabled:border-accent hover:not-disabled:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-accent aria-pressed:bg-accent-soft"
        >
          <Icon name={callIcon[call]} size="md" className={callTone[call]} />
          <span className="truncate">{label}</span>
          <Keycap keys={key} size="sm" />
        </button>
      ))}
    </div>
  );
}
