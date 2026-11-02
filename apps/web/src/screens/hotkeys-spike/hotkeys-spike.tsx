import { useState } from "react";
import { type Binding, type Fired, parseKeys } from "../../keys/registry.ts";
import { useHotkeys } from "../../keys/use-hotkeys.ts";

const bindings: Binding[] = [
  { action: "Go to AI area 2", keys: parseKeys("G then 2") },
  { action: "Whole slide", keys: ["Z"], hold: true },
  { action: "Slide brighter", keys: ["⌥↑"], inInputs: true },
];

type Log = { last: string; taps: number; holds: number; peek: boolean; closing: boolean };

function logged(current: Log, fired: Fired): Log {
  const next = { ...current, last: `${fired.action} ${fired.phase}` };
  if (fired.phase === "hold-start")
    return current.peek ? { ...next, peek: false, closing: true } : { ...next, peek: true };
  if (fired.phase === "tap")
    return current.closing
      ? { ...next, closing: false }
      : { ...next, taps: current.taps + 1, peek: true };
  if (fired.phase === "hold-end")
    return current.closing
      ? { ...next, closing: false }
      : { ...next, holds: current.holds + 1, peek: false };
  return next;
}

export function HotkeysSpike() {
  const [log, setLog] = useState<Log>({
    last: "",
    taps: 0,
    holds: 0,
    peek: false,
    closing: false,
  });
  const [pending, setPending] = useState<string[] | null>(null);
  const onFire = (fired: Fired) => setLog((current) => logged(current, fired));
  useHotkeys(bindings, onFire, setPending);
  return (
    <main className="grid max-w-xl gap-4 p-8 text-fg">
      <h1 className="text-lg font-semibold">Hotkeys spike</h1>
      <p className="text-fg-2">
        Press G then 2. Tap Z to open the whole slide, press it again to close, or hold it to peek.
      </p>
      <label className="grid gap-1">
        <span>Note</span>
        <input aria-label="Note" className="rounded-md border border-line bg-chrome-2 px-2 py-1" />
      </label>
      <output
        aria-label="Hotkey status"
        data-last={log.last}
        data-taps={log.taps}
        data-holds={log.holds}
        data-peek={log.peek ? "open" : "closed"}
        data-pending={pending?.join(" ") ?? ""}
        className="grid gap-1 font-mono text-sm"
      >
        <span>Last: {log.last || "nothing yet"}</span>
        <span>Waiting for: {pending ? `${pending.join(" then ")} then …` : "nothing"}</span>
        <span>
          Taps {log.taps}, holds {log.holds}, whole slide {log.peek ? "open" : "closed"}
        </span>
      </output>
    </main>
  );
}
