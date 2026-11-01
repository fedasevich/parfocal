import { Field as FieldPrimitive } from "@base-ui/react/field";
import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "cn";
import type * as React from "react";

type FormFieldProps = Omit<FieldPrimitive.Root.Props, "children"> & {
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
  warning?: React.ReactNode;
  required?: boolean;
  optional?: boolean;
  count?: React.ReactNode;
  children: React.ReactNode;
};

function FormField({
  label,
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
  const message = error ?? warning;
  return (
    <FieldPrimitive.Root
      data-slot="form-field"
      invalid={Boolean(error)}
      className={cn("group/field grid min-w-0 gap-1.5", className)}
      {...props}
    >
      <FieldPrimitive.Label className="flex items-baseline justify-between gap-3 text-body-sm font-semibold text-fg">
        <span>
          {label}
          {optional ? <span className="ml-1.5 font-normal text-fg-dim">Optional</span> : null}
        </span>
        {required ? <span className="text-caption font-normal text-fg-dim">Required</span> : null}
      </FieldPrimitive.Label>
      {children}
      {message || help || count ? (
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
      ) : null}
    </FieldPrimitive.Root>
  );
}

const fieldControlClass =
  "w-full min-h-8 rounded-ctl border border-line-strong bg-surf-field px-2.5 text-body-sm text-fg outline-none placeholder:text-fg-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] group-data-invalid/field:border-bad disabled:cursor-not-allowed disabled:opacity-45";

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

export {
  FormField,
  type FormFieldProps,
  fieldControlClass,
  TextFieldInput,
  type TextFieldInputProps,
};
