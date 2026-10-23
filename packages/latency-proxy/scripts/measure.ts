import { measureAddedLatency } from "#measure.ts";
import { startOriginServer } from "#origin.ts";
import { RTT_MATRIX_MS, startLatencyProxy, transferMs } from "#proxy.ts";

const SAMPLES = Number(process.env.SAMPLES ?? 20);
const origin = await startOriginServer();
const proxy = await startLatencyProxy({ target: origin.url });

try {
  console.log(`Added latency, 1 KiB responses, ${SAMPLES} sequential samples per row`);
  console.log(
    "| Set RTT (ms) | Direct median (ms) | Proxied median (ms) | Added median (ms) | Added min (ms) | Added max (ms) |",
  );
  console.log("|---|---|---|---|---|---|");
  for (const rttMs of RTT_MATRIX_MS) {
    proxy.setConditions({ rttMs, bandwidthBytesPerSecond: null });
    const sample = await measureAddedLatency(
      `${origin.url}/bytes/1024`,
      `${proxy.url}/bytes/1024`,
      SAMPLES,
    );
    console.log(
      `| ${rttMs} | ${sample.directMs.toFixed(2)} | ${sample.proxiedMs.toFixed(2)} | ${sample.addedMs.toFixed(2)} | ${sample.addedMinMs.toFixed(2)} | ${sample.addedMaxMs.toFixed(2)} |`,
    );
  }

  console.log("\nBandwidth, 0 ms RTT, one 1 MB response");
  console.log("| Limit (B/s) | Expected (ms) | Measured (ms) |");
  console.log("|---|---|---|");
  for (const bandwidthBytesPerSecond of [1_000_000, 5_000_000, 20_000_000]) {
    proxy.setConditions({ rttMs: 0, bandwidthBytesPerSecond });
    const started = performance.now();
    await (await fetch(`${proxy.url}/bytes/1000000`)).arrayBuffer();
    const measured = performance.now() - started;
    console.log(
      `| ${bandwidthBytesPerSecond} | ${transferMs(1_000_000, bandwidthBytesPerSecond).toFixed(0)} | ${measured.toFixed(1)} |`,
    );
  }
} finally {
  await proxy.close();
  await origin.close();
}
