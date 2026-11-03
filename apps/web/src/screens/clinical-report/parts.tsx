import { useGetClinicalReport, useListClinicalReports } from "@parfocal/api-client";
import type { LinkRenderer } from "@parfocal/ui/components/app-shell";
import { Icon, type IconName } from "@parfocal/ui/components/icon";
import { Toast } from "@parfocal/ui/components/undo-toast";
import { cn } from "@parfocal/ui/lib/utils";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import type { ReportScene } from "./model.ts";

export const fieldId = (field: string) => `report-field-${field.replace(/\./g, "-")}`;

export function KvList({
  rows,
  className,
}: {
  rows: { icon: IconName; label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "m-0 grid grid-cols-[168px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-body-sm leading-[1.45]",
        className,
      )}
    >
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="flex min-w-0 items-start gap-2 text-fg-dim">
            <Icon name={row.icon} className="mt-0.5 shrink-0" />
            <span>{row.label}</span>
          </dt>
          <dd className="m-0 min-w-0 text-fg [overflow-wrap:anywhere]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const NotSet = ({ children = "Not set" }: { children?: ReactNode }) => (
  <span className="text-fg-faint">{children}</span>
);

export function useLinkRenderer(): LinkRenderer {
  const router = useRouter();
  return ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        void router.navigate({ href });
      }}
    >
      {children}
    </a>
  );
}

export type ToastMessage = { text: string; undo?: () => void };

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const view = toast ? (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center">
      <Toast className="pointer-events-auto">
        {toast.text}
        {toast.undo ? (
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-accent"
            onClick={() => {
              toast.undo?.();
              setToast(null);
            }}
          >
            Undo
          </button>
        ) : null}
      </Toast>
    </div>
  ) : null;
  return { show: setToast, view };
}

export function useReportData(projectId: string, slideId: string, scene: ReportScene) {
  const rows = useListClinicalReports(projectId, {
    query: { enabled: scene === "nostaging" },
  });
  const excision = rows.data?.data.find((row) => !row.has_staging)?.slide_id;
  const target = scene === "nostaging" ? excision : slideId;
  const report = useGetClinicalReport(projectId, target ?? slideId, {
    query: { enabled: target !== undefined },
  });
  return {
    data: target === undefined ? undefined : report.data?.data,
    pending: report.isPending || rows.isLoading,
    failed: Boolean(report.error ?? rows.error),
  };
}

export const linkButton =
  "cursor-pointer border-0 bg-transparent p-0 text-body-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
