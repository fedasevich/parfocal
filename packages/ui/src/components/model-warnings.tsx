import { WarnBar } from "@parfocal/ui/components/inspector";
import { Zone } from "@parfocal/ui/components/zone";
import type { ModelWarning } from "@parfocal/ui/lib/model-warnings";
import type * as React from "react";

type ModelWarningsBlockProps = Omit<React.ComponentProps<"section">, "title"> & {
  warnings: readonly ModelWarning[];
  enabled?: boolean;
};

function ModelWarningsBlock({ warnings, enabled = true, ...props }: ModelWarningsBlockProps) {
  if (!enabled || warnings.length === 0) return null;
  return (
    <Zone
      data-slot="model-warnings"
      aria-label="Model warnings"
      title="Model warnings"
      end={
        warnings.length > 1 ? (
          <span className="font-mono text-caption text-fg-dim">{warnings.length}</span>
        ) : null
      }
      {...props}
    >
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {warnings.map((warning) => (
          <li key={warning.kind} data-kind={warning.kind}>
            <WarnBar>{warning.text}</WarnBar>
          </li>
        ))}
      </ul>
    </Zone>
  );
}

export { ModelWarningsBlock, type ModelWarningsBlockProps };
