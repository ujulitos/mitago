// Reading stats, local only. PURE, unit-tested in node. A stats record is
// { bookId, ms, days: { <localDay>: ms }, firstAt, lastAt } (store.js 'stats').

import { localDay } from './logic.js';

/** Add `ms` of active reading at `now` to a book's record (null = first time). */
export function addStatTime(rec, bookId, now, ms, day = localDay(now)) {
  const days = { ...rec?.days };
  days[day] = (days[day] ?? 0) + ms;
  return { bookId, ms: (rec?.ms ?? 0) + ms, days, firstAt: rec?.firstAt ?? now, lastAt: now };
}

/** Two records of one book (import): per day the larger count, total never below either. */
export function mergeStats(a, b) {
  if (!a || !b) return a ?? b;
  const days = { ...a.days };
  for (const [d, ms] of Object.entries(b.days ?? {})) days[d] = Math.max(days[d] ?? 0, ms);
  const sum = Object.values(days).reduce((x, y) => x + y, 0);
  return { bookId: a.bookId, ms: Math.max(a.ms ?? 0, b.ms ?? 0, sum), days, firstAt: Math.min(a.firstAt ?? Infinity, b.firstAt ?? Infinity), lastAt: Math.max(a.lastAt ?? 0, b.lastAt ?? 0) };
}

/**
 * The library's summary: total time, the last 7 days (today included), days-read
 * streak (ending today, or yesterday while today is still unread) and books finished.
 */
export function libraryStats(stats, positions, today) {
  const perDay = new Map();
  let total = 0;
  for (const s of stats) {
    total += s.ms ?? 0;
    for (const [d, ms] of Object.entries(s.days ?? {})) perDay.set(Number(d), (perDay.get(Number(d)) ?? 0) + ms);
  }
  let week = 0;
  for (let d = today - 6; d <= today; d++) week += perDay.get(d) ?? 0;
  let streak = 0;
  for (let d = perDay.get(today) ? today : today - 1; perDay.get(d) > 0; d--) streak++;
  const finished = positions.filter((p) => (p.progress ?? 0) >= 0.9995).length;
  return { total, week, streak, finished };
}

/** Whole hours and minutes (rounded down to the minute). */
export function hoursMinutes(ms) {
  const min = Math.floor(Math.max(0, ms) / 60000);
  return { h: Math.floor(min / 60), m: min % 60 };
}
