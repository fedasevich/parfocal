import { Trans, useLingui } from "@lingui/react/macro";
import { useGetTaskTiming } from "@parfocal/api-client";
import { okData, QueryState } from "../placeholder.tsx";
import { CorrectionsCard } from "./corrections-card.tsx";
import { kpiEventsOf } from "./kpi-live.ts";
import { areaMedians, computeKpis, formatKpiValue } from "./kpi-model.ts";

export function KpiScreen() {
  const { t } = useLingui();
  const timing = useGetTaskTiming();
  const events = kpiEventsOf(okData(timing.data)?.events ?? []);
  const kpis = computeKpis(events);
  const areas = areaMedians(events);
  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-8" data-testid="kpi-dashboard">
      <header className="grid gap-1">
        <h1 className="font-semibold text-page-title text-fg">
          <Trans>Task timing</Trans>
        </h1>
        <p
          className="text-body text-fg-dim"
          data-testid="kpi-source"
          data-source={events.length > 0 ? "recorded" : "empty"}
        >
          {events.length > 0
            ? t`Figures from the timing events of people who allow analytics, with no person, case or slide named.`
            : t`No timing recorded yet. Figures appear as people who allow analytics finish tasks.`}
        </p>
      </header>
      <QueryState label={t`task timing`} isPending={timing.isPending} error={timing.error}>
        <table className="w-full text-body" data-testid="kpi-table">
          <thead>
            <tr className="text-left text-body-sm text-fg-dim">
              <th className="py-2">
                <Trans>Measure</Trans>
              </th>
              <th>
                <Trans>Samples</Trans>
              </th>
              <th>
                <Trans>Median</Trans>
              </th>
              <th>
                <Trans>Slowest tenth</Trans>
              </th>
              <th>
                <Trans>Kit target</Trans>
              </th>
              <th>
                <Trans>Status</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {kpis.map((kpi) => (
              <tr key={kpi.key} className="border-t border-line" data-testid={`kpi-${kpi.key}`}>
                <td className="py-2 text-fg">{kpi.label}</td>
                <td className="font-mono">{kpi.samples}</td>
                <td className="font-mono">{formatKpiValue(kpi.median, kpi.unit)}</td>
                <td className="font-mono">{formatKpiValue(kpi.slowest, kpi.unit)}</td>
                <td className="text-fg-dim">
                  {kpi.target === null
                    ? t`No kit target yet`
                    : t`${formatKpiValue(kpi.target.limit, kpi.unit)} or less`}
                </td>
                <td data-testid={`kpi-${kpi.key}-status`}>
                  {kpi.met === null ? t`Not judged` : kpi.met ? t`On target` : t`Over target`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="grid gap-2">
          <h2 className="font-semibold text-fg">
            <Trans>Median time per area visit</Trans>
          </h2>
          <ul className="grid gap-1 text-body">
            {areas.map((entry) => (
              <li key={entry.area} className="flex justify-between border-t border-line py-1">
                <span className="text-fg">{entry.area}</span>
                <span className="font-mono">
                  <Trans>{entry.minutes} min</Trans>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </QueryState>
      <CorrectionsCard />
    </main>
  );
}
