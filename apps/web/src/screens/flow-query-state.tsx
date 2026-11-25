import { Trans, useLingui } from "@lingui/react/macro";
import { FlowPageSkeleton } from "@parfocal/ui/components/flow-page";
import type { ReactNode } from "react";

type FlowQueryStateProps = {
  label: string;
  pending: boolean;
  steps?: number;
  children: ReactNode;
};

export function FlowQueryState({ label, pending, steps = 0, children }: FlowQueryStateProps) {
  const { t } = useLingui();

  if (pending) {
    return (
      <FlowPageSkeleton className="h-full" label={t`Loading ${label}`} steps={steps}>
        {children}
      </FlowPageSkeleton>
    );
  }
  return (
    <main className="p-8">
      <p role="alert" className="text-bad text-body">
        <Trans>Could not load {label}.</Trans>
      </p>
    </main>
  );
}
