import { Trans, useLingui } from "@lingui/react/macro";
import { Loader } from "@parfocal/ui/components/loader";
import type { ReactNode } from "react";

type PlaceholderProps = {
  title: string;
  builtBy: string;
  route: Record<string, unknown>;
  children?: ReactNode;
};

export function Placeholder({ title, builtBy, route, children }: PlaceholderProps) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-page-title text-fg">{title}</h1>
        <p className="text-fg-dim text-body">
          <Trans>Placeholder. The screen is built by {builtBy}.</Trans>
        </p>
      </header>
      <pre className="rounded-md border border-line bg-chrome p-3 text-fg-dim text-caption">
        {JSON.stringify(route, null, 2)}
      </pre>
      {children}
    </main>
  );
}

type QueryStateProps = {
  label: string;
  isPending: boolean;
  error: unknown;
  children: ReactNode;
};

export function QueryState({ label, isPending, error, children }: QueryStateProps) {
  const { t } = useLingui();

  if (isPending) return <Loader label={t`Loading ${label}`} />;
  if (error) {
    return (
      <p role="alert" className="text-bad text-body">
        <Trans>Could not load {label}.</Trans>
      </p>
    );
  }
  return <section aria-label={label}>{children}</section>;
}

export function okData<Response extends { status: number; data: unknown }>(
  response: Response | undefined,
): Extract<Response, { status: 200 }>["data"] | undefined {
  return response?.status === 200
    ? (response as Extract<Response, { status: 200 }>).data
    : undefined;
}
