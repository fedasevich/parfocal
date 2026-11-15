import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { cn } from "@parfocal/ui/lib/utils";
import type * as React from "react";

type IngestFailureClass = "transient" | "permanent";

const classCopy: Record<IngestFailureClass, { title: MessageDescriptor; next: string }> = {
  transient: {
    title: msg`did not finish`,
    next: "This is usually temporary. Sending the file again often works.",
  },
  permanent: {
    title: msg`was refused`,
    next: "Sending this file again will not change the result. If it should work, tell support.",
  },
};

type IngestFailureProps = Omit<React.ComponentProps<"div">, "title"> & {
  fileName: string;
  message: string;
  failureClass: IngestFailureClass;
  supportHref?: string | undefined;
  onRetry?: (() => void) | undefined;
};

function IngestFailure({
  fileName,
  message,
  failureClass,
  supportHref,
  onRetry,
  className,
  ...props
}: IngestFailureProps) {
  const { t } = useLingui();

  const copy = classCopy[failureClass];
  return (
    <div
      data-slot="ingest-failure"
      data-failure-class={failureClass}
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-zone border border-l-4 bg-chrome px-3.5 py-3 text-body-sm text-fg",
        failureClass === "transient"
          ? "border-warn [&>svg]:text-warn"
          : "border-bad [&>svg]:text-bad",
        className,
      )}
      {...props}
    >
      <Icon name="warn" className="mt-0.5" />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="m-0 font-semibold">
          <span className="font-mono font-medium">{fileName}</span> {t(copy.title)}
        </p>
        <p className="m-0 leading-[1.45]">{message}</p>
        <p className="m-0 leading-[1.45] text-fg-dim">{copy.next}</p>
        {failureClass === "transient" && onRetry ? (
          <Button size="sm" className="mt-1 w-fit" onClick={onRetry}>
            <Trans>Try again</Trans>
          </Button>
        ) : null}
        {failureClass === "permanent" && supportHref ? (
          <a
            href={supportHref}
            className="mt-1 w-fit font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
          >
            <Trans>Contact support</Trans>
          </a>
        ) : null}
      </div>
    </div>
  );
}

export { IngestFailure, type IngestFailureClass, type IngestFailureProps };
