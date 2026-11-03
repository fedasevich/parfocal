import { Field as FieldPrimitive } from "@base-ui/react/field";
import { Fieldset as FieldsetPrimitive } from "@base-ui/react/fieldset";
import { Checkbox } from "@parfocal/ui/components/checkbox";
import { Icon } from "@parfocal/ui/components/icon";
import { RadioGroup } from "@parfocal/ui/components/radio-group";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type FormFieldProps = Omit<FieldPrimitive.Root.Props, "children"> & {
  label: React.ReactNode;
  labelId?: string;
  help?: React.ReactNode;
  error?: React.ReactNode;
  warning?: React.ReactNode;
  required?: boolean;
  optional?: boolean;
  count?: React.ReactNode;
  children: React.ReactNode;
};

type FieldFooterProps = {
  help?: React.ReactNode;
  error?: React.ReactNode;
  warning?: React.ReactNode;
  count?: React.ReactNode;
};

function FieldFooter({ help, error, warning, count }: FieldFooterProps) {
  const message = error ?? warning;
  if (!message && !help && !count) return null;
  return (
    <div className="flex items-baseline gap-3">
      {message ? (
        <FieldPrimitive.Error
          match
          className={cn(
            "m-0 flex min-w-0 flex-1 items-start gap-1.5 text-body-sm leading-[1.45]",
            error ? "text-bad" : "text-warn",
          )}
        >
          <Icon name="warn" className="mt-0.5" />
          <span>{message}</span>
        </FieldPrimitive.Error>
      ) : help ? (
        <FieldPrimitive.Description className="m-0 flex-1 text-body-sm leading-[1.45] text-fg-dim">
          {help}
        </FieldPrimitive.Description>
      ) : (
        <span className="flex-1" />
      )}
      {count ? (
        <span className="ml-auto text-caption whitespace-nowrap text-fg-dim">{count}</span>
      ) : null}
    </div>
  );
}

function FormField({
  label,
  labelId,
  help,
  error,
  warning,
  required = false,
  optional = false,
  count,
  className,
  children,
  ...props
}: FormFieldProps) {
  return (
    <FieldPrimitive.Root
      data-slot="form-field"
      invalid={Boolean(error)}
      className={cn("group/field grid min-w-0 gap-1.5", className)}
      {...props}
    >
      <FieldPrimitive.Label
        id={labelId}
        className="flex items-baseline justify-between gap-3 text-body-sm font-semibold text-fg"
      >
        <span>
          {label}
          {optional ? <span className="ml-1.5 font-normal text-fg-dim">Optional</span> : null}
        </span>
        {required ? <span className="text-caption font-normal text-fg-dim">Required</span> : null}
      </FieldPrimitive.Label>
      {children}
      <FieldFooter error={error} warning={warning} help={help} count={count} />
    </FieldPrimitive.Root>
  );
}

const fieldControlClass =
  "w-full min-h-8 rounded-ctl border border-line-strong bg-surf-field px-2.5 text-body-sm text-fg outline-none placeholder:text-fg-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] group-data-invalid/field:border-bad group-data-invalid/field:focus:border-bad group-data-invalid/field:focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--bad)_35%,transparent)] disabled:cursor-not-allowed disabled:opacity-45";

type TextFieldInputProps = FieldPrimitive.Control.Props;

function TextFieldInput({ className, ...props }: TextFieldInputProps) {
  return (
    <FieldPrimitive.Control
      data-slot="text-field-input"
      className={cn(fieldControlClass, className)}
      {...props}
    />
  );
}

type TextAreaInputProps = Omit<React.ComponentProps<"textarea">, "value" | "defaultValue"> & {
  value?: string;
  defaultValue?: string;
};

function TextAreaInput({ className, rows = 3, ...props }: TextAreaInputProps) {
  return (
    <FieldPrimitive.Control
      data-slot="text-area-input"
      render={<textarea rows={rows} {...props} />}
      className={cn(fieldControlClass, "min-h-16 resize-y py-2 leading-[1.45]", className)}
    />
  );
}

function characterCount(text: string, limit: number) {
  return `${text.length} of ${limit}`;
}

type CheckboxFieldProps = Omit<FieldPrimitive.Root.Props, "children"> & {
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

function CheckboxField({
  label,
  help,
  error,
  required = false,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: CheckboxFieldProps) {
  return (
    <FieldPrimitive.Root
      data-slot="checkbox-field"
      invalid={Boolean(error)}
      disabled={disabled ?? false}
      className={cn("group/field grid min-w-0 gap-1.5", className)}
      {...props}
    >
      <FieldPrimitive.Label className="flex cursor-pointer items-start gap-2.5 text-body-sm text-fg group-data-disabled/field:cursor-not-allowed">
        <Checkbox
          className="mt-0.5 group-data-invalid/field:border-bad"
          required={required}
          disabled={disabled ?? false}
          {...(checked === undefined ? {} : { checked })}
          {...(defaultChecked === undefined ? {} : { defaultChecked })}
          {...(onCheckedChange ? { onCheckedChange: (next) => onCheckedChange(next) } : {})}
        />
        <span className="group-data-disabled/field:opacity-45">
          {label}
          {required ? <span className="ml-1.5 text-caption text-fg-dim">Required</span> : null}
        </span>
      </FieldPrimitive.Label>
      <div className="pl-6.5">
        <FieldFooter error={error} help={help} />
      </div>
    </FieldPrimitive.Root>
  );
}

type RadioFieldProps = {
  legend: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
  className?: string;
  children: React.ReactNode;
};

function RadioField({
  legend,
  help,
  error,
  required = false,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  name,
  className,
  children,
}: RadioFieldProps) {
  return (
    <FieldPrimitive.Root
      data-slot="radio-field"
      invalid={Boolean(error)}
      disabled={disabled}
      {...(name ? { name } : {})}
      className={cn("group/field grid min-w-0 gap-1.5", className)}
    >
      <FieldsetPrimitive.Root
        render={
          <RadioGroup
            className="gap-2.5"
            required={required}
            disabled={disabled}
            {...(value === undefined ? {} : { value })}
            {...(defaultValue === undefined ? {} : { defaultValue })}
            {...(onValueChange ? { onValueChange: (next) => onValueChange(String(next)) } : {})}
          />
        }
      >
        <FieldsetPrimitive.Legend className="mb-1 flex w-full items-baseline justify-between gap-3 text-body-sm font-semibold text-fg">
          <span>{legend}</span>
          {required ? <span className="text-caption font-normal text-fg-dim">Required</span> : null}
        </FieldsetPrimitive.Legend>
        {children}
      </FieldsetPrimitive.Root>
      <FieldFooter error={error} help={help} />
    </FieldPrimitive.Root>
  );
}

export {
  CheckboxField,
  type CheckboxFieldProps,
  characterCount,
  FormField,
  type FormFieldProps,
  fieldControlClass,
  RadioField,
  type RadioFieldProps,
  TextAreaInput,
  type TextAreaInputProps,
  TextFieldInput,
  type TextFieldInputProps,
};
