import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type IngestSkippedProps = Omit<React.ComponentProps<"div">, "title"> & {
  fileName: string;
  message?: string | undefined;
};

function IngestSkipped({
  fileName,
  message = "Skipped, already in this project.",
  className,
  ...props
}: IngestSkippedProps) {
  return (
    <div
      data-slot="ingest-skipped"
      role="status"
      className={cn(
        "flex items-center gap-3 rounded-zone border border-l-4 border-line-strong bg-chrome px-3.5 py-3 text-body-sm text-fg-dim",
        className,
      )}
      {...props}
    >
      <Icon name="check" className="text-fg-faint" />
      <p className="m-0 min-w-0 leading-[1.45]">
        <span className="font-mono font-medium text-fg">{fileName}</span> {message}
      </p>
    </div>
  );
}

export { IngestSkipped, type IngestSkippedProps };
