import { useEffect, useState } from "react";

/**
 * Current unix time in seconds, ticking every second.
 * Lets pages recompute phase state (OPEN/VOTING/ended) exactly when a
 * deadline passes instead of waiting for the next data poll.
 */
export function useNow(): number {
  const [now, setNow] = useState<number>(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Returns seconds remaining until `targetUnixSeconds`.
 * Updates every second. Returns 0 when expired.
 */
export function useCountdown(targetUnixSeconds: number): number {
  const [remaining, setRemaining] = useState<number>(
    Math.max(0, targetUnixSeconds - Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    const tick = () => {
      const secs = Math.max(0, targetUnixSeconds - Math.floor(Date.now() / 1000));
      setRemaining(secs);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetUnixSeconds]);

  return remaining;
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
