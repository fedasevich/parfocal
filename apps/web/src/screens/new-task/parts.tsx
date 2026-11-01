import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { RadioGroup, RadioGroupItem } from "@parfocal/ui/components/radio-group";
import { Switch } from "@parfocal/ui/components/switch";
import { cn } from "@parfocal/ui/lib/utils";
import type { ReactNode } from "react";

export const fieldId = (field: string) => `task-field-${field.replace(/\./g, "-")}`;

export function FieldNote({
  error,
  help,
  count,
}: {
  error?: string | undefined;
  help?: ReactNode;
  count?: string;
}) {
  if (!error && !help && !count) return null;
  return (
    <div className="flex items-baseline gap-3">
      {error ? (
        <p
          role="alert"
          className="m-0 flex flex-1 items-start gap-1.5 text-body-sm leading-[1.45] text-bad"
        >
          <Icon name="warn" className="mt-0.5" />
          <span>{error}</span>
        </p>
      ) : (
        <p className="m-0 flex-1 text-body-sm leading-[1.45] text-fg-dim">{help}</p>
      )}
      {count ? <span className="text-caption whitespace-nowrap text-fg-dim">{count}</span> : null}
    </div>
  );
}

export function Warn({ icon = "warn", children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-body-sm leading-[1.45] text-warn">
      <Icon name={icon} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function SlideThumb({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-md border border-line bg-cover bg-center"
      style={{ width: size, height: size, backgroundImage: "url(/mock-assets/overview.jpg)" }}
    />
  );
}

export function RowText({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <span className="grid min-w-0">
      <b className="text-body-sm font-medium text-fg">{title}</b>
      {sub ? <small className="mt-px text-body-sm leading-[1.45] text-fg-dim">{sub}</small> : null}
    </span>
  );
}

export function CheckRow({
  checked,
  onChange,
  label,
  children,
  end,
  className,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  children: ReactNode;
  end?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "grid min-h-8 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 text-body-sm",
        disabled ? "cursor-default opacity-55" : "cursor-pointer",
        className,
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled ?? false}
        aria-label={label}
        onCheckedChange={(value) => onChange(value)}
      />
      <span className="flex min-w-0 items-center gap-2.5">{children}</span>
      <span className="text-body-sm whitespace-nowrap text-fg-dim">{end}</span>
    </label>
  );
}

export type RadioOption = {
  value: string;
  title: string;
  sub?: string;
  end?: ReactNode;
  disabled?: string;
  under?: ReactNode;
};

export function RadioRows({
  label,
  value,
  onChange,
  options,
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  id?: string;
}) {
  return (
    <RadioGroup
      id={id}
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(String(next))}
      className="grid gap-2.5"
    >
      {options.map((option) => (
        <div key={option.value} className="grid gap-1.5">
          <label
            className={cn(
              "flex items-start gap-3",
              option.disabled ? "cursor-default opacity-55" : "cursor-pointer",
            )}
            title={option.disabled}
          >
            <RadioGroupItem
              value={option.value}
              disabled={Boolean(option.disabled)}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <RowText title={option.title} sub={option.disabled ?? option.sub} />
            </span>
            {option.end ? (
              <span className="text-body-sm whitespace-nowrap text-fg-dim">{option.end}</span>
            ) : null}
          </label>
          {value === option.value ? option.under : null}
        </div>
      ))}
    </RadioGroup>
  );
}

export function ToggleRow({
  title,
  sub,
  checked,
  onChange,
  id,
  inline = false,
}: {
  title: string;
  sub?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  inline?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-4",
        inline ? "min-h-8 justify-start gap-3" : "justify-between",
      )}
    >
      <span className="grid min-w-0">
        {inline ? (
          <span className="text-body-sm text-fg">{title}</span>
        ) : (
          <b className="text-body-sm font-semibold text-fg">{title}</b>
        )}
        {sub ? (
          <small className="mt-0.5 text-caption leading-[1.45] text-fg-dim">{sub}</small>
        ) : null}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={(value) => onChange(value)} />
    </label>
  );
}

export function GroupTitle({ children }: { children: ReactNode }) {
  return <h4 className="m-0 text-caption font-semibold text-fg-dim">{children}</h4>;
}
