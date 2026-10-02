// =====================================================================
// Vacuum State - game clock ("time contract")
// ONE clock for the whole game. Nothing else keeps its own time.
//
//   game time = days since J2000 (same unit physics.js uses)
//   real time = normal JavaScript milliseconds (Date.now())
//
// scale = how many game seconds pass per real second.
//   60 means 1 real minute = 1 game hour (your GDD). Earth orbit = ~6 real days.
// =====================================================================
import { J2000_MS } from './physics.js';

const LAUNCH_MS = Date.UTC(2026, 9, 3, 0, 0, 0); // Oct 3 2026 00:00 UTC (month is 0-based)

export const CLOCK = {
  epochRealMs: LAUNCH_MS,                                   // the moment the game "starts"
  epochGameDays: (LAUNCH_MS - J2000_MS) / 864e5,            // start in the REAL sky positions
  scale: 60,
};

export function gameDaysAt(realMs, c = CLOCK) {
  return c.epochGameDays + (realMs - c.epochRealMs) * c.scale / 864e5;
}

export function realMsAt(gameDays, c = CLOCK) {
  return c.epochRealMs + (gameDays - c.epochGameDays) * 864e5 / c.scale;
}

// Change the speed WITHOUT game time jumping (used for dev "100x" testing).
export function rescale(c, nowMs, newScale) {
  return { epochRealMs: nowMs, epochGameDays: gameDaysAt(nowMs, c), scale: newScale };
}

export const gameDate = (gameDays) => new Date(J2000_MS + gameDays * 864e5).toISOString();
