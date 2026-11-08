import { readEventLog } from "../../telemetry/event-log.ts";
import { liveKpiEvents } from "./kpi-live.ts";
import { areaMedians, computeKpis, formatKpiValue } from "./kpi-model.ts";
import { seededKpiEvents } from "./kpi-seed.ts";

export function KpiScreen() {
  const live = liveKpiEvents(readEventLog());
  const events = live.length > 0 ? live : seededKpiEvents;
  const kpis = computeKpis(events);
  const areas = areaMedians(events);
  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-8" data-testid="kpi-dashboard">
      <header className="grid gap-1">
        <h1 className="font-semibold text-page-title text-fg">Task timing</h1>
        <p
          className="text-body text-fg-dim"
          data-testid="kpi-seeded-note"
          data-source={live.length > 0 ? "recorded" : "seeded"}
        >
          {live.length > 0
            ? "Figures from the ids-only timing events recorded on this device."
            : "Seeded sample data. Real figures come from ids-only events of people who allow analytics."}
        </p>
      </header>
      <table className="w-full text-body" data-testid="kpi-table">
        <thead>
          <tr className="text-left text-body-sm text-fg-dim">
            <th className="py-2">Measure</th>
            <th>Samples</th>
            <th>Median</th>
            <th>Slowest tenth</th>
            <th>Kit target</th>
            <th>Status</th>
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
                  ? "No kit target yet"
                  : `${formatKpiValue(kpi.target.limit, kpi.unit)} or less`}
              </td>
              <td data-testid={`kpi-${kpi.key}-status`}>
                {kpi.met === null ? "Not judged" : kpi.met ? "On target" : "Over target"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="grid gap-2">
        <h2 className="font-semibold text-fg">Median time per area visit</h2>
        <ul className="grid gap-1 text-body">
          {areas.map((entry) => (
            <li key={entry.area} className="flex justify-between border-t border-line py-1">
              <span className="text-fg">{entry.area}</span>
              <span className="font-mono">{entry.minutes} min</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
