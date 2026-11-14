import { Trans, useLingui } from "@lingui/react/macro";
import { readEventLog } from "../../telemetry/event-log.ts";
import { liveKpiEvents } from "./kpi-live.ts";
import { areaMedians, computeKpis, formatKpiValue } from "./kpi-model.ts";
import { seededKpiEvents } from "./kpi-seed.ts";

export function KpiScreen() {
  const { t } = useLingui();

  const live = liveKpiEvents(readEventLog());
  const events = live.length > 0 ? live : seededKpiEvents;
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
          data-testid="kpi-seeded-note"
          data-source={live.length > 0 ? "recorded" : "seeded"}
        >
          {live.length > 0
            ? t`Figures from the ids-only timing events recorded on this device.`
            : t`Seeded sample data. Real figures come from ids-only events of people who allow analytics.`}
        </p>
      </header>
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
    </main>
  );
}
