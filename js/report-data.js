// report-data — every number the Log and Reports tabs show. PURE: plain data in, plain data out.
// rules: spec §6.4–6.5 and plan-3 Global Constraints (past days use planHistory, nothing missed before
// the first workout, a rest-day workout is a done day, today counts as planned only once done).
import { weekdayKey, addDays, addMonths, weekStart, daysInMonth, monthKey } from './dates.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// ---------- planned days ----------
export function trainingDaysOn(planHistory, day) {
  let days = [];
  for (const e of planHistory) if (e.from <= day) days = e.trainingDays;
  return days;
}
export const isPlanned = (planHistory, day) => trainingDaysOn(planHistory, day).includes(weekdayKey(day));

// ---------- sessions by day ----------
export function firstDayOf(sessions) {
  let first = null;
  for (const s of sessions) if (!first || s.date < first) first = s.date;
  return first;
}
export function byDay(sessions) {
  const m = new Map();
  for (const s of sessions) {
    if (!m.has(s.date)) m.set(s.date, []);
    m.get(s.date).push(s);
  }
  return m;
}

export function dayStatus(day, { sessionsOnDay = [], planHistory, today, firstDay }) {
  if (sessionsOnDay.some((s) => s.status === 'done')) return 'done';
  if (sessionsOnDay.length) return 'partial';
  if (!isPlanned(planHistory, day)) return 'rest';
  if (day === today) return 'planned';
  if (day > today || !firstDay || day < firstDay) return 'upcoming';
  return 'missed';
}

export function streak(sessions, planHistory, today) {
  const first = firstDayOf(sessions);
  if (!first) return 0;
  const has = byDay(sessions);
  let n = 0;
  for (let d = today; d >= first; d = addDays(d, -1)) {
    if (has.has(d)) n++;
    else if (d !== today && isPlanned(planHistory, d)) break; // today isn't missed yet
  }
  return n;
}

export function consistency(sessions, planHistory, from, to, today) {
  const first = firstDayOf(sessions);
  if (!first) return { done: 0, planned: 0 };
  const has = byDay(sessions);
  let done = 0, planned = 0;
  const start = from > first ? from : first;
  const end = to < today ? to : today;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const worked = has.has(d);
    if (isPlanned(planHistory, d)) {
      if (d === today && !worked) continue;
      planned++;
      if (worked) done++;
    } else if (worked) { planned++; done++; }
  }
  return { done, planned };
}

// ---------- periods ----------
export function periodRange(kind, anchorDay) {
  if (kind === 'week') {
    const from = weekStart(anchorDay);
    return { from, to: addDays(from, 6) };
  }
  const mk = monthKey(anchorDay);
  return { from: `${mk}-01`, to: `${mk}-${String(daysInMonth(mk)).padStart(2, '0')}` };
}
export function previousPeriod(kind, anchorDay) {
  if (kind === 'week') return periodRange('week', addDays(weekStart(anchorDay), -7));
  return periodRange('month', `${addMonths(monthKey(anchorDay), -1)}-01`);
}
export const inRange = (sessions, from, to) => sessions.filter((s) => s.date >= from && s.date <= to);

// local 'YYYY-MM-DDTHH:mm:ss' → ms (never via UTC)
function tsMs(ts) {
  const [d, t = '00:00:00'] = ts.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, se = 0] = t.split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi, se).getTime();
}
export const totalSec = (sessions) =>
  sessions.reduce((n, s) => n + (s.endedAt ? Math.max(0, Math.round((tsMs(s.endedAt) - tsMs(s.startedAt)) / 1000)) : 0), 0);

// ---------- volume ----------
const doneSets = (item) => item.sets.filter((x) => x.status === 'done');
const setKg = (x) => (x.actual.weight != null && x.actual.reps != null ? x.actual.weight * x.actual.reps : 0);
const itemKg = (item) => doneSets(item).reduce((n, x) => n + setKg(x), 0);

export const sessionVolume = (session) => session.items.reduce((n, it) => n + itemKg(it), 0);

export function volumeByCategory(sessions, exercises) {
  const catsOf = new Map(exercises.map((e) => [e.id, e.categoryIds?.length ? e.categoryIds : ['uncategorized']]));
  const kg = new Map();
  for (const s of sessions) {
    for (const it of s.items) {
      const v = itemKg(it);
      if (!v) continue;
      for (const c of catsOf.get(it.exerciseId) ?? ['uncategorized']) kg.set(c, (kg.get(c) ?? 0) + v);
    }
  }
  return [...kg].map(([categoryId, v]) => ({ categoryId, kg: v })).filter((r) => r.kg > 0).sort((a, b) => b.kg - a.kg);
}

// ---------- best set ----------
const mainKey = (fields) => (fields.weight ? 'weight' : fields.reps ? 'reps' : 'duration');

export function bestSet(sets, fields) {
  const key = mainKey(fields);
  let best = null;
  for (const v of sets) {
    if (v[key] == null) continue;
    const better = !best || v[key] > best[key] || (key === 'weight' && v[key] === best[key] && (v.reps ?? 0) > (best.reps ?? 0));
    if (better) best = v;
  }
  return best && { weight: best.weight ?? null, reps: best.reps ?? null, duration: best.duration ?? null };
}

const exerciseActuals = (sessions, exerciseId) => sessions.flatMap((s) => s.items
  .filter((it) => it.exerciseId === exerciseId)
  .flatMap((it) => doneSets(it).map((x) => x.actual)));

export function bestTrend(sessions, exerciseId, fieldsOf, kind, count = 8, today) {
  const fields = fieldsOf(exerciseId) || {};
  const key = mainKey(fields);
  const out = [];
  let anchor = today;
  for (let i = 0; i < count; i++) {
    const { from, to } = periodRange(kind, anchor);
    const best = bestSet(exerciseActuals(inRange(sessions, from, to), exerciseId), fields);
    const [, m, d] = from.split('-');
    out.unshift({ key: from, label: kind === 'week' ? `${d}/${m}` : MONTHS[Number(m) - 1], value: best?.[key] ?? 0 });
    anchor = addDays(from, -1);
  }
  return out;
}

// ---------- plan vs actual ----------
function compareSet(x, fields, circuit) {
  const keys = ['weight', 'reps', ...(circuit ? [] : ['duration'])].filter((k) => fields[k] && x.planned[k] != null);
  if (!keys.length) return null;
  if (keys.some((k) => (x.actual[k] ?? 0) < x.planned[k])) return 'below';
  return keys.some((k) => (x.actual[k] ?? 0) > x.planned[k]) ? 'above' : 'equal';
}

export function planVsActual(sessions, exerciseId, fieldsOf) {
  const fields = fieldsOf(exerciseId) || {};
  const r = { above: 0, equal: 0, below: 0, streakAbove: 0 };
  for (const s of sessions) {
    const counts = { above: 0, equal: 0, below: 0 };
    for (const it of s.items.filter((i) => i.exerciseId === exerciseId)) {
      for (const x of doneSets(it)) {
        if (!x.planned) continue; // extra sets have nothing to compare with
        const c = compareSet(x, fields, !!it.circuitId);
        if (c) counts[c]++;
      }
    }
    const max = Math.max(counts.above, counts.equal, counts.below);
    if (!max) continue;
    const winners = Object.keys(counts).filter((k) => counts[k] === max);
    const verdict = winners.length > 1 ? 'equal' : winners[0];
    r[verdict]++;
    r.streakAbove = verdict === 'above' ? r.streakAbove + 1 : 0;
  }
  return r;
}
