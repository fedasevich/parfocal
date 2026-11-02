import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { PUBLISH_HEADER } from "#realtime.ts";
import { ROOM_PROTOCOL } from "#room-client.ts";
import { roomKey, signPublish, signRoomToken } from "#room-token.ts";

type Page = {
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
};
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
type Playwright = {
  chromium: { launch(options: { channel?: string; headless: boolean }): Promise<Browser> };
};

const { values: options } = parseArgs({
  options: {
    url: { type: "string" },
    rounds: { type: "string", default: "20" },
    vars: { type: "string", default: `${import.meta.dirname}/../.dev.vars` },
  },
});
const base = options.url ?? "";
const rounds = Number(options.rounds);
const secret = /^ROOM_TOKEN_KEY=(.+)$/m.exec(readFileSync(options.vars, "utf8"))?.[1]?.trim() ?? "";
if (base === "" || secret === "") {
  throw new Error("Pass --url https://host and keep ROOM_TOKEN_KEY in the --vars file");
}

const playwright = createRequire(`${import.meta.dirname}/../../web/package.json`)(
  "@playwright/test",
) as Playwright;

const key = await roomKey(secret);
const tenant = randomUUID();
const project = randomUUID();
const slide = randomUUID();
const thread = randomUUID();
const room = `slide:${slide}`;
const socketUrl = `${base.replace(/^http/, "ws")}/rt/${room}`;

async function tokenFor(user: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + 300;
  return signRoomToken({ tenant, project, room, user, expires }, key);
}

async function publish(kind: string, ids: Record<string, string>): Promise<number> {
  const body = JSON.stringify({ tenant, rooms: [room], event: { kind, ids } });
  const stamp = Math.floor(Date.now() / 1000);
  const sentAt = Date.now();
  const response = await fetch(`${base}/rt-internal/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [PUBLISH_HEADER]: await signPublish(key, stamp, body),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`publish answered ${response.status}`);
  }
  return sentAt;
}

async function open(browser: Browser, user: string): Promise<Page> {
  const page = await browser.newPage();
  const token = await tokenFor(user);
  await page.evaluate(
    ({ url, protocol, token }) =>
      new Promise<void>((resolve, reject) => {
        const seen: Record<string, number> = {};
        const socket = new WebSocket(url, [protocol, token]);
        Object.assign(globalThis, { seen });
        socket.addEventListener("message", (message: MessageEvent) => {
          const frame = JSON.parse(String(message.data)) as {
            type: string;
            kind?: string;
            ids?: Record<string, string>;
          };
          if (frame.type === "event" && frame.ids?.mark) {
            seen[frame.ids.mark] = Date.now();
          }
        });
        socket.addEventListener("open", () => resolve());
        socket.addEventListener("error", () => reject(new Error("socket failed")));
      }),
    { url: socketUrl, protocol: ROOM_PROTOCOL, token },
  );
  return page;
}

async function arrival(page: Page, mark: string): Promise<number> {
  return page.evaluate(
    (wanted) =>
      new Promise<number>((resolve, reject) => {
        const started = Date.now();
        const look = () => {
          const at = (globalThis as unknown as { seen: Record<string, number> }).seen[wanted];
          if (at !== undefined) {
            resolve(at);
          } else if (Date.now() - started > 5000) {
            reject(new Error("event never arrived"));
          } else {
            setTimeout(look, 5);
          }
        };
        look();
      }),
    mark,
  );
}

function summary(values: number[]): { median: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? Number.NaN;
  return { median: at(0.5), p95: at(0.95), max: at(1) };
}

const browsers = await Promise.all([
  playwright.chromium.launch({ channel: "chrome", headless: true }),
  playwright.chromium.launch({ channel: "chrome", headless: true }),
]);
const pages = await Promise.all(browsers.map((browser) => open(browser, randomUUID())));

const latencies = new Map<string, number[]>([
  ["presence.joined", []],
  ["thread.updated", []],
]);
for (let round = 0; round < rounds; round += 1) {
  for (const [kind, values] of latencies) {
    const mark = randomUUID();
    const ids = kind === "thread.updated" ? { thread, mark } : { slide, mark };
    const sentAt = await publish(kind, ids);
    const arrived = await Promise.all(pages.map((page) => arrival(page, mark)));
    values.push(Math.max(...arrived) - sentAt);
  }
}

await Promise.all(browsers.map((browser) => browser.close()));
console.log(
  JSON.stringify({
    target: new URL(base).host,
    rounds,
    browsers: 2,
    latency_ms_slower_browser: Object.fromEntries(
      [...latencies].map(([kind, values]) => [kind, summary(values)]),
    ),
  }),
);
