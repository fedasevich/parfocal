import { CONTROL_PATH, startLatencyProxy } from "#proxy.ts";

const bandwidth = process.env.BANDWIDTH_BYTES_PER_SECOND;
const proxy = await startLatencyProxy({
  target: process.env.TARGET ?? "http://localhost:5173",
  port: Number(process.env.PORT ?? 5399),
  host: process.env.HOST ?? "127.0.0.1",
  rttMs: Number(process.env.RTT_MS ?? 100),
  bandwidthBytesPerSecond: bandwidth ? Number(bandwidth) : null,
});

const { rttMs, bandwidthBytesPerSecond } = proxy.conditions();
console.log(
  `${proxy.url} -> ${process.env.TARGET ?? "http://localhost:5173"} at ${rttMs} ms RTT, ${bandwidthBytesPerSecond === null ? "unlimited" : `${bandwidthBytesPerSecond} B/s`}. Change it with ${proxy.url}${CONTROL_PATH}?rtt=50&bandwidth=1000000`,
);

const stop = () => {
  proxy.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
