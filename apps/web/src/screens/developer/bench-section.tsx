import { Button } from "@parfocal/ui/components/button";
import { DevFigures, DevStatus, DevZone } from "@parfocal/ui/components/developer-drawer";
import { Icon } from "@parfocal/ui/components/icon";
import { useState, useSyncExternalStore } from "react";
import type { DebugHandleHost } from "../../debug-handle.ts";
import {
  type BenchmarkLog,
  type BenchmarkRow,
  type BenchmarkValue,
  benchmarkFileName,
  benchmarkLog,
  downloadCsv,
  NoSlideOpen,
  sweepAndLog,
} from "../../lab/pan-sweep.ts";
import { benchRuns, csvColumns } from "./developer-data.ts";

type RunRow = [string, string, string, string, string, string];

function cell(value: BenchmarkValue): string {
  return value === null ? "" : String(value);
}

function nucleiText(value: BenchmarkValue): string {
  if (typeof value !== "number") return cell(value);
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1_000) return `${value / 1_000}k`;
  return String(value);
}

function ms(value: BenchmarkValue): string {
  return value === null ? "" : `${value} ms`;
}

export function runRow(row: BenchmarkRow): RunRow {
  return [
    cell(row.renderer),
    nucleiText(row.nuclei),
    cell(row.zoom),
    ms(row.frameP50),
    ms(row.frameP95),
    cell(row.fps),
  ];
}

const mockRuns: RunRow[] = benchRuns.map(([name, nuclei, zoom, p50, p95, fps]) => [
  name,
  nuclei,
  String(zoom),
  `${p50} ms`,
  `${p95} ms`,
  String(fps),
]);

export function BenchSection({
  route,
  host = globalThis as DebugHandleHost,
  log = benchmarkLog,
}: {
  route: string;
  host?: DebugHandleHost;
  log?: BenchmarkLog;
}) {
  const rows = useSyncExternalStore(log.subscribe, log.rows, log.rows);
  const count = useSyncExternalStore(log.subscribe, log.count, log.count);
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const last = rows.at(-1);
  const run = async () => {
    const zoom = host.__parfocal?.getCamera?.()?.scale ?? 0;
    setRunning(true);
    setStatus("Sweeping 180 steps");
    try {
      await sweepAndLog(host, zoom, log);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof NoSlideOpen ? error.message : "The pan sweep stopped");
    } finally {
      setRunning(false);
    }
  };
  const shown = (count === 0 ? mockRuns : rows.map(runRow)).map((cells, position) => ({
    run: `run ${position + 1}`,
    cells,
  }));
  return (
    <>
      <DevZone
        title="Pan sweep"
        note="Pans a 180-step ellipse at this zoom, then waits 600 ms for tiles to settle."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={running} onClick={() => void run()}>
            Run pan sweep
          </Button>
          <DevStatus live={status !== null}>
            {status ??
              (last === undefined
                ? `Last run 14:02 · ${route} · 100k nuclei · zoom 2`
                : `Last run · ${cell(last.renderer)} · ${nucleiText(last.nuclei)} nuclei · zoom ${cell(last.zoom)}`)}
          </DevStatus>
        </div>
        <DevFigures
          items={
            last === undefined
              ? [
                  ["6.2 ms", "frame p50"],
                  ["11.8 ms", "frame p95"],
                  ["60", "fps"],
                  ["412", "tiles resident"],
                ]
              : [
                  [ms(last.frameP50), "frame p50"],
                  [ms(last.frameP95), "frame p95"],
                  [cell(last.fps), "fps"],
                  [cell(last.tilesResident), "tiles resident"],
                ]
          }
        />
      </DevZone>
      <DevZone
        title="Runs"
        end={
          <Button
            size="sm"
            disabled={count === 0}
            onClick={() => downloadCsv(log.csv(), benchmarkFileName(new Date()))}
          >
            <Icon name="download" />
            Export CSV, {count} {count === 1 ? "run" : "runs"}
          </Button>
        }
      >
        <table className="w-full border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-line text-left text-caption text-fg-faint">
              <th className="py-1.5 font-semibold">Renderer</th>
              {["Nuclei", "Zoom", "p50", "p95", "fps"].map((name) => (
                <th key={name} className="py-1.5 text-right font-semibold">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {shown.map(({ run, cells: [name, nuclei, zoom, p50, p95, fps] }) => (
              <tr key={run} className="border-b border-line last:border-b-0">
                <td className="py-1.5 font-semibold text-fg">{name}</td>
                <td className="py-1.5 text-right">{nuclei}</td>
                <td className="py-1.5 text-right">{zoom}</td>
                <td className="py-1.5 text-right">{p50}</td>
                <td className="py-1.5 text-right">{p95}</td>
                <td className="py-1.5 text-right">{fps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DevZone>
      <DevZone title="CSV columns">
        <div className="flex flex-wrap gap-1.5">
          {csvColumns.map((column) => (
            <code
              key={column}
              className="rounded-sm bg-chrome-3 px-1.5 py-0.5 font-mono text-caption"
            >
              {column}
            </code>
          ))}
        </div>
      </DevZone>
    </>
  );
}
