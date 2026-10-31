import { CONTROL_PATH, startLatencyProxy } from "#proxy.ts";

function rate(value: string | undefined): number | null {
  return value ? Number(value) : null;
}

function describeRate(value: number | null): string {
  return value === null ? "unlimited" : `${value} B/s`;
}

const proxy = await startLatencyProxy({
  target: process.env.TARGET ?? "http://localhost:5173",
  port: Number(process.env.PORT ?? 5399),
  host: process.env.HOST ?? "127.0.0.1",
  rttMs: Number(process.env.RTT_MS ?? 100),
  bandwidthBytesPerSecond: rate(process.env.BANDWIDTH_BYTES_PER_SECOND),
  uplinkBytesPerSecond: rate(process.env.UPLINK_BYTES_PER_SECOND),
});

const { rttMs, bandwidthBytesPerSecond, uplinkBytesPerSecond } = proxy.conditions();
console.log(
  `${proxy.url} -> ${process.env.TARGET ?? "http://localhost:5173"} at ${rttMs} ms RTT, ${describeRate(bandwidthBytesPerSecond)} down, ${describeRate(uplinkBytesPerSecond)} up. Change it with ${proxy.url}${CONTROL_PATH}?rtt=50&bandwidth=1000000&uplink=1000000`,
);

const stop = () => {
  proxy.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
