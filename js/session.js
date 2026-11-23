// session — the workout state machine. PURE: no DOM, no storage.
// every function takes a Session and returns a NEW one (callers persist it via store.saveActive).
// Session shape: spec §5 + §6.3b, plus
//   run = {itemIdx, setIdx, phase:'set'|'break'|'finished', timerStartedAt:ms|null, extraSec, pausedAt:ms|null}
// circuit items carry circuitId and their sets carry round (1-based); normal items have circuitId null.
import { elapsedSec } from './timer.js';
import { isCircuit, flatItems } from './planshape.js';

const VALUE_KEYS = ['weight', 'reps', 'duration', 'break'];
const DURATION_ROUND = 5; // matches the time wheel step; smaller timer differences are noise
const clone = (x) => structuredClone(x);
const valueOf = (s) => Object.fromEntries(VALUE_KEYS.map((k) => [k, s?.[k] ?? null]));
const emptyValue = () => valueOf(null);
const freshRun = (itemIdx = 0, setIdx = 0, timerStartedAt = null) =>
  ({ itemIdx, setIdx, phase: 'set', timerStartedAt, extraSec: 0, pausedAt: null });
const itemAt = (s) => (s.run ? s.items[s.run.itemIdx] : null);

// derived, never stored: normal items set by set; a run of items sharing a circuitId goes round-robin
export function executionOrder(s) {
  const order = [];
  let i = 0;
  while (i < s.items.length) {
    const cid = s.items[i].circuitId;
    if (!cid) {
      s.items[i].sets.forEach((_, j) => order.push([i, j]));
      i++;
      continue;
    }
    let end = i;
    while (end < s.items.length && s.items[end].circuitId === cid) end++;
    const rounds = Math.max(...s.items.slice(i, end).map((it) => it.sets.length));
    for (let r = 0; r < rounds; r++) {
      for (let k = i; k < end; k++) if (s.items[k].sets[r]) order.push([k, r]);
    }
    i = end;
  }
  return order;
}

// cursor → first pending set in execution order (circuit steps start their clock now), or finished
function advance(s, nowMs = null) {
  const next = executionOrder(s).find(([i, j]) => s.items[i].sets[j].status === 'pending');
  if (!next) { s.run = { ...freshRun(), phase: 'finished' }; return s; }
  const [i, j] = next;
  s.run = freshRun(i, j, s.items[i].circuitId ? nowMs : null);
  return s;
}
const hasPending = (s) => s.items.some((i) => i.sets.some((x) => x.status === 'pending'));

const sessionItem = (it, circuitId = null, rounds = 0) => ({
  exerciseId: it.exerciseId,
  planItemId: it.id,
  circuitId,
  sets: circuitId
    ? Array.from({ length: rounds }, (_, r) => {
      const ps = it.sets[0];
      return { planSetId: ps?.id ?? null, round: r + 1, planned: valueOf(ps), actual: valueOf(ps), status: 'pending' };
    })
    : it.sets.map((ps) => ({ planSetId: ps.id, planned: valueOf(ps), actual: valueOf(ps), status: 'pending' })),
});

// planItems = the day's entries (exercises and circuits; pre-circuit plans are plain exercises)
export function startSession({ planItems, planDay, date, startedAt, nowMs = null }) {
  const s = {
    id: `${date}-${startedAt}`,
    date, planDay, startedAt, endedAt: null, status: null,
    items: planItems.flatMap((e) => (isCircuit(e)
      ? e.items.map((it) => sessionItem(it, e.id, e.rounds))
      : [sessionItem(e)])),
    run: freshRun(),
  };
  return advance(s, nowMs);
}

export function currentSet(s) {
  if (!s?.run || s.run.phase === 'finished') return null;
  const item = s.items[s.run.itemIdx];
  const set = item?.sets[s.run.setIdx];
  return set ? { item, set, itemIdx: s.run.itemIdx, setIdx: s.run.setIdx } : null;
}

export const isCircuitStep = (s) => !!(s?.run && s.run.phase !== 'finished' && itemAt(s)?.circuitId);

export function startSetTimer(s, nowMs) {
  if (s.run.phase !== 'set' || s.run.timerStartedAt != null) return s;
  const n = clone(s);
  n.run.timerStartedAt = nowMs;
  return n;
}

export function completeSet(s, actualPatch, nowMs, fieldsOf) {
  if (s.run.phase !== 'set' || !currentSet(s)) return s;
  const n = clone(s);
  const { item, set } = currentSet(n);
  const fields = fieldsOf(item.exerciseId) || {};
  const target = set.actual.duration;
  Object.assign(set.actual, actualPatch);
  if (fields.duration && n.run.timerStartedAt != null) {
    const took = elapsedSec(n.run.timerStartedAt, nowMs);
    // circuits have no overtime: work ends exactly at its target
    set.actual.duration = item.circuitId && target != null ? Math.min(took, target) : took;
  }
  set.status = 'done';
  if (fields.break && set.actual.break != null && hasPending(n)) {
    n.run = { ...n.run, phase: 'break', timerStartedAt: nowMs, extraSec: 0, pausedAt: null };
    return n;
  }
  return advance(n, nowMs);
}

export function addBreakTime(s, sec) {
  if (s.run.phase !== 'break') return s;
  const n = clone(s);
  n.run.extraSec += sec;
  return n;
}

export function endBreak(s, nowMs) {
  if (s.run.phase !== 'break') return s;
  const n = clone(s);
  n.items[n.run.itemIdx].sets[n.run.setIdx].actual.break = elapsedSec(n.run.timerStartedAt, nowMs);
  return advance(n, nowMs);
}

export function skipSet(s, nowMs = null) {
  if (s.run.phase !== 'set' || !currentSet(s)) return s;
  const n = clone(s);
  currentSet(n).set.status = 'skipped';
  return advance(n, nowMs);
}

export function skipExercise(s, nowMs = null) {
  if (s.run.phase !== 'set' || !currentSet(s)) return s;
  const n = clone(s);
  for (const x of currentSet(n).item.sets) if (x.status === 'pending') x.status = 'skipped';
  return advance(n, nowMs);
}

// after adding work to a finished session, move the cursor onto it
const reopen = (n) => (n.run.phase === 'finished' ? advance(n) : n);

export function addSetToCurrent(s) {
  const target = s.items[s.run.itemIdx] ?? s.items.at(-1);
  if (!target || target.circuitId) return s; // circuits: change rounds in the plan instead
  const n = clone(s);
  const item = n.items[s.run.itemIdx] ?? n.items.at(-1);
  const last = item.sets.at(-1);
  const actual = { ...valueOf(last?.actual), duration: last?.planned?.duration ?? null };
  // breakTarget: the break this extra set aims for (actual.break gets overwritten by the measured one)
  item.sets.push({ planSetId: null, planned: null, actual, breakTarget: actual.break, status: 'pending' });
  return reopen(n);
}

export function addExercise(s, exerciseId) {
  const n = clone(s);
  n.items.push({ exerciseId, planItemId: null, circuitId: null, sets: [{ planSetId: null, planned: null, actual: emptyValue(), breakTarget: null, status: 'pending' }] });
  return reopen(n);
}

const untouched = (item) => item.sets.every((x) => x.status === 'pending');

// only normal items not started AND not the current one move, so the cursor (and a running timer) never changes
export function moveRemaining(s, itemIdx, delta) {
  const to = itemIdx + delta;
  const a = s.items[itemIdx], b = s.items[to];
  const isCurrent = (i) => s.run && s.run.phase !== 'finished' && s.run.itemIdx === i;
  if (!a || !b || a.circuitId || b.circuitId || !untouched(a) || !untouched(b) || isCurrent(itemIdx) || isCurrent(to)) return s;
  const n = clone(s);
  [n.items[itemIdx], n.items[to]] = [n.items[to], n.items[itemIdx]];
  return n;
}

// ---------- pause / resume ----------
export function pause(s, nowMs) {
  if (!s.run || s.run.phase === 'finished' || s.run.pausedAt != null) return s;
  const n = clone(s);
  n.run.pausedAt = nowMs;
  return n;
}

export function resume(s, nowMs) {
  if (!s.run || s.run.pausedAt == null) return s;
  const n = clone(s);
  if (n.run.timerStartedAt != null) n.run.timerStartedAt += nowMs - n.run.pausedAt;
  n.run.pausedAt = null;
  return n;
}

// after an app kill: a circuit step restarts in full, paused — never auto-complete unseen minutes
export function restartStepPaused(s, nowMs) {
  if (!isCircuitStep(s)) return s;
  const n = clone(s);
  n.run.timerStartedAt = nowMs;
  n.run.pausedAt = nowMs;
  return n;
}

// fix reps/kg of a set that just ended (circuit break screen)
export function editDoneSet(s, itemIdx, setIdx, patch) {
  const x = s.items[itemIdx]?.sets[setIdx];
  if (!x || x.status !== 'done') return s;
  const n = clone(s);
  Object.assign(n.items[itemIdx].sets[setIdx].actual, patch);
  return n;
}

// hands-free circuit flow: performs every step whose time has ended, with exact timestamps,
// so live ticks and catch-up after the app was backgrounded are the same code.
// returns the SAME object when nothing changed.
export function tickCircuit(s, nowMs, fieldsOf) {
  let cur = s;
  for (let guard = 0; guard < 10000; guard++) {
    if (!isCircuitStep(cur) || cur.run.pausedAt != null || cur.run.timerStartedAt == null) return cur;
    const { item, set } = currentSet(cur);
    const start = cur.run.timerStartedAt;
    if (cur.run.phase === 'set') {
      const f = fieldsOf(item.exerciseId) || {};
      const target = set.actual.duration;
      if (!f.duration || target == null) return cur;          // reps-only step waits for Done
      const end = start + target * 1000;
      if (nowMs < end) return cur;
      cur = completeSet(cur, {}, end, fieldsOf);
    } else {
      const end = start + (set.actual.break + cur.run.extraSec) * 1000;
      if (nowMs < end) return cur;
      cur = endBreak(cur, end);
    }
  }
  return cur;
}

export function finish(s, endedAt, { quit = false } = {}) {
  const n = clone(s);
  if (quit) for (const it of n.items) for (const x of it.sets) if (x.status === 'pending') x.status = 'skipped';
  n.status = n.items.some((it) => it.sets.some((x) => x.status !== 'done')) ? 'partial' : 'done';
  n.endedAt = endedAt;
  delete n.run;
  return n;
}

const roundDuration = (sec) => (sec == null ? null : Math.round(sec / DURATION_ROUND) * DURATION_ROUND);
const minOf = (vals) => {
  const nums = vals.filter((v) => v != null);
  return nums.length ? Math.min(...nums) : null;
};

// what the finish screen offers as "update plan" rows (see plan-2 / plan-2b Global Constraints)
export function diffFromPlan(s, fieldsOf) {
  const rows = [];
  s.items.forEach((item, i) => {
    const f = fieldsOf(item.exerciseId) || {};
    const done = item.sets.map((x, j) => [x, j]).filter(([x]) => x.status === 'done');
    if (item.circuitId) {
      if (!done.length) return;
      const planned = item.sets[0].planned;
      const differs = done.some(([x]) => (f.weight && x.actual.weight !== planned.weight) || (f.reps && x.actual.reps !== planned.reps));
      if (!differs) return;
      const rounds = done.map(([x]) => valueOf(x.actual));
      rows.push({
        key: `c${i}`, kind: 'circuit', exerciseId: item.exerciseId, planItemId: item.planItemId,
        planSetId: item.sets[0].planSetId, from: { ...planned }, rounds,
        to: {
          ...planned,
          weight: f.weight ? minOf(rounds.map((r) => r.weight)) : planned.weight,
          reps: f.reps ? minOf(rounds.map((r) => r.reps)) : planned.reps,
        },
      });
      return;
    }
    // the plan gets the target break, never the measured one (skip / +15s / phone in hand)
    const to = (x) => ({
      ...valueOf(x.actual),
      duration: roundDuration(x.actual.duration),
      break: x.planned ? x.planned.break : (x.breakTarget ?? null),
    });
    if (item.planItemId == null) {
      if (done.length) rows.push({ key: `x${i}`, kind: 'extraExercise', exerciseId: item.exerciseId, sets: done.map(([x]) => to(x)) });
      return;
    }
    for (const [x, j] of done) {
      const key = `${i}:${j}`;
      if (x.planned == null) {
        rows.push({ key, kind: 'extraSet', exerciseId: item.exerciseId, planItemId: item.planItemId, to: to(x) });
        continue;
      }
      const t = to(x);
      const changed = (f.weight && t.weight !== x.planned.weight)
        || (f.reps && t.reps !== x.planned.reps)
        || (f.duration && t.duration !== x.planned.duration);
      if (changed) {
        rows.push({ key, kind: 'changed', exerciseId: item.exerciseId, planItemId: item.planItemId, planSetId: x.planSetId, from: { ...x.planned }, to: t });
      }
    }
  });
  return rows;
}

// entries = a plan day (exercises and circuits). returns new entries; never mutates input.
// rows whose targets are gone are skipped.
export function applyDiff(entries, rows, makeId) {
  const out = clone(entries);
  const items = () => flatItems(out); // references into `out`, so edits land in place
  const setById = (id) => items().flatMap((it) => it.sets).find((x) => x.id === id);
  for (const r of rows) {
    if (r.kind === 'changed') {
      const set = setById(r.planSetId);
      if (set) Object.assign(set, { weight: r.to.weight, reps: r.to.reps, duration: r.to.duration });
    } else if (r.kind === 'circuit') {
      const set = setById(r.planSetId);
      if (set) Object.assign(set, { weight: r.to.weight, reps: r.to.reps });
    } else if (r.kind === 'extraSet') {
      const item = items().find((it) => it.id === r.planItemId);
      if (item) item.sets.push({ id: makeId(), ...valueOf(r.to) });
    } else if (r.kind === 'extraExercise') {
      out.push({ id: makeId(), exerciseId: r.exerciseId, sets: r.sets.map((v) => ({ id: makeId(), ...valueOf(v) })) });
    }
  }
  return out;
}
