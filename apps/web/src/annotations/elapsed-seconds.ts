import { useEffect, useState } from "react";

export const elapsedTickMs = 1000;

export function wholeSecondsSince(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function useElapsedSeconds(running: string | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (running === null) return;
    const startedAt = Date.now();
    const ticker = setInterval(
      () => setSeconds(wholeSecondsSince(startedAt, Date.now())),
      elapsedTickMs,
    );
    return () => clearInterval(ticker);
  }, [running]);
  return seconds;
}
