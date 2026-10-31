import type { Game, Seat } from "./types";

// Must match scripts/gen-rules.py.
export const GRACE = 1500;
export const COUNTDOWN = 3000;

/** Remaining ms on a seat's clock, mirroring the settlement rule in database.rules.json. */
export function clockMs(g: Game, seat: Seat, now: number): number {
  if (g.status === "waiting") return g.base;
  if (g.status === "over" && g.reason === "time" && g.turn === seat) return 0;
  let b = g[seat === 0 ? "b0" : "b1"] ?? g.base;
  if (g.owe === seat) b = b - (g.turnAt! - g.prevAt!) + g.inc;
  else if (g.status === "playing" && g.turn === seat) b -= now - g.turnAt!;
  return g.owe === -1 ? Math.min(b, g.base) : b; // the first mover's extra 3s covers the countdown
}

/** Ms left in the 3-2-1 countdown before the first move (0 once play has started). */
export const countdownLeft = (g: Game, now: number) =>
  g.status === "playing" && g.owe === -1 ? Math.max(0, g.turnAt! + COUNTDOWN - now) : 0;

export function fmtClock(ms: number): string {
  ms = Math.max(0, ms);
  if (ms < 10000) return `0:0${(Math.floor(ms / 100) / 10).toFixed(1)}`;
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const tcLabel = (g: { base: number; inc: number }) => `${g.base / 1000}s +${g.inc / 1000}`;
