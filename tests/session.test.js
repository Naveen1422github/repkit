import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startSession, currentSet, startSetTimer, completeSet, addBreakTime, endBreak,
  skipSet, skipExercise, addSetToCurrent, addExercise, moveRemaining, finish,
  diffFromPlan, applyDiff,
} from '../js/session.js';

const FIELDS = {
  bench: { weight: true, reps: true, duration: false, break: true },
  plank: { weight: false, reps: false, duration: true, break: false },
  curl: { weight: true, reps: true, duration: false, break: false },
};
const fieldsOf = (id) => FIELDS[id];
const S = (id, v) => ({ id, weight: null, reps: null, duration: null, break: null, ...v });

const plan = () => [
  { id: 'pb', exerciseId: 'bench', sets: [S('b1', { weight: 20, reps: 12, break: 60 }), S('b2', { weight: 20, reps: 12, break: 60 })] },
  { id: 'pp', exerciseId: 'plank', sets: [S('p1', { duration: 60 })] },
];
const start = (items = plan()) => startSession({ planItems: items, planDay: 'mon', date: '2026-11-23', startedAt: '2026-11-23T18:00:00' });

test('startSession snapshots plan and pre-fills actual', () => {
  const s = start();
  assert.equal(s.items.length, 2);
  const all = s.items.flatMap((i) => i.sets);
  assert.equal(all.length, 3);
  assert.ok(all.every((x) => x.status === 'pending'));
  assert.deepEqual(s.items[0].sets[0].planned, { weight: 20, reps: 12, duration: null, break: 60 });
  assert.deepEqual(s.items[0].sets[0].actual, s.items[0].sets[0].planned);
  assert.equal(s.items[0].sets[0].planSetId, 'b1');
  assert.equal(s.items[0].planItemId, 'pb');
  assert.deepEqual({ ...s.run }, { itemIdx: 0, setIdx: 0, phase: 'set', timerStartedAt: null, extraSec: 0, pausedAt: null });
  assert.equal(s.date, '2026-11-23');
  assert.equal(s.planDay, 'mon');
  assert.equal(currentSet(s).set.planSetId, 'b1');
});

test('startSession does not share objects with the plan', () => {
  const items = plan();
  const s = start(items);
  s.items[0].sets[0].actual.weight = 99;
  assert.equal(items[0].sets[0].weight, 20);
});

test('startSession with no items is finished', () => {
  assert.equal(start([]).run.phase, 'finished');
});

test('completeSet with break goes to break, then endBreak records break and advances', () => {
  let s = start();
  s = completeSet(s, {}, 0, fieldsOf);
  assert.equal(s.run.phase, 'break');
  assert.equal(s.run.timerStartedAt, 0);
  assert.equal(s.items[0].sets[0].status, 'done');
  s = addBreakTime(s, 15);
  assert.equal(s.run.extraSec, 15);
  s = endBreak(s, 75000);
  assert.equal(s.items[0].sets[0].actual.break, 75);
  assert.equal(s.run.itemIdx, 0);
  assert.equal(s.run.setIdx, 1);
  assert.equal(s.run.phase, 'set');
  assert.equal(s.run.timerStartedAt, null);
  assert.equal(s.run.extraSec, 0);
});

test('completeSet merges patch', () => {
  const s = completeSet(start(), { reps: 15, weight: 25 }, 0, fieldsOf);
  assert.deepEqual(s.items[0].sets[0].actual, { weight: 25, reps: 15, duration: null, break: 60 });
  assert.equal(s.items[0].sets[0].status, 'done');
});

test('completeSet is a no-op outside phase set', () => {
  const inBreak = completeSet(start(), {}, 0, fieldsOf);
  const again = completeSet(inBreak, { reps: 1 }, 1000, fieldsOf);
  assert.deepEqual(again, inBreak);
  assert.equal(again.items[0].sets[1].status, 'pending');
});

test('last set before a timed exercise still gets its break; final set of workout gets none', () => {
  let s = start();
  s = endBreak(completeSet(s, {}, 0, fieldsOf), 1000);
  s = completeSet(s, {}, 2000, fieldsOf);           // bench set 2 → break before plank
  assert.equal(s.run.phase, 'break');
  s = endBreak(s, 3000);
  assert.equal(currentSet(s).item.exerciseId, 'plank');
  // a workout whose final set has a break: no break screen after it
  let one = start([{ id: 'pb', exerciseId: 'bench', sets: [S('b1', { reps: 5, break: 60 })] }]);
  one = completeSet(one, {}, 0, fieldsOf);
  assert.equal(one.run.phase, 'finished');
});

test('timed set measures duration', () => {
  let s = start([{ id: 'pp', exerciseId: 'plank', sets: [S('p1', { duration: 60 })] }]);
  s = startSetTimer(s, 0);
  assert.equal(s.run.timerStartedAt, 0);
  assert.equal(startSetTimer(s, 5000).run.timerStartedAt, 0); // already started: no-op
  s = completeSet(s, {}, 72400, fieldsOf);
  assert.equal(s.items[0].sets[0].actual.duration, 72);
  assert.equal(s.run.phase, 'finished');
});

test('skipSet skips its break; skipExercise skips remaining sets of item', () => {
  let s = skipSet(start());
  assert.equal(s.items[0].sets[0].status, 'skipped');
  assert.equal(s.run.phase, 'set');
  assert.equal(s.run.setIdx, 1);
  s = skipExercise(start());
  assert.deepEqual(s.items[0].sets.map((x) => x.status), ['skipped', 'skipped']);
  assert.equal(currentSet(s).item.exerciseId, 'plank');
});

test('addSetToCurrent copies actual with planned null; addExercise appends planItemId null', () => {
  let s = completeSet(start(), { reps: 15 }, 0, fieldsOf);
  s = endBreak(s, 1000);
  s = addSetToCurrent(s);
  const added = s.items[0].sets[2];
  assert.equal(added.planned, null);
  assert.equal(added.planSetId, null);
  assert.equal(added.status, 'pending');
  assert.equal(added.actual.weight, 20);
  s = addExercise(s, 'curl');
  const last = s.items.at(-1);
  assert.equal(last.exerciseId, 'curl');
  assert.equal(last.planItemId, null);
  assert.equal(last.sets.length, 1);
  assert.deepEqual(last.sets[0].actual, { weight: null, reps: null, duration: null, break: null });
});

test('moveRemaining refuses items with done sets', () => {
  let s = addExercise(start(), 'curl');
  const moved = moveRemaining(s, 2, -1);
  assert.deepEqual(moved.items.map((i) => i.exerciseId), ['bench', 'curl', 'plank']);
  s = completeSet(s, {}, 0, fieldsOf);
  const refused = moveRemaining(s, 1, -1);
  assert.deepEqual(refused.items.map((i) => i.exerciseId), ['bench', 'plank', 'curl']);
});

test('finish quit marks pending skipped and partial; removes run', () => {
  const s = finish(completeSet(start(), {}, 0, fieldsOf), '2026-11-23T18:30:00', { quit: true });
  assert.equal(s.status, 'partial');
  assert.equal(s.endedAt, '2026-11-23T18:30:00');
  assert.equal('run' in s, false);
  assert.deepEqual(s.items.flatMap((i) => i.sets.map((x) => x.status)), ['done', 'skipped', 'skipped']);
});

test('finish all done is done', () => {
  let s = start([{ id: 'pc', exerciseId: 'curl', sets: [S('c1', { reps: 10 })] }]);
  s = completeSet(s, {}, 0, fieldsOf);
  assert.equal(finish(s, '2026-11-23T18:10:00').status, 'done');
});

test('diffFromPlan lists changed weight/reps only for ticked fields', () => {
  let s = completeSet(start(), { reps: 15, weight: 25 }, 0, fieldsOf);
  s = endBreak(s, 60000);
  s = completeSet(s, { duration: 999 }, 70000, fieldsOf); // duration not ticked on bench: ignored
  const rows = diffFromPlan(s, fieldsOf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'changed');
  assert.equal(rows[0].planSetId, 'b1');
  assert.equal(rows[0].planItemId, 'pb');
  assert.equal(rows[0].exerciseId, 'bench');
  assert.equal(rows[0].from.reps, 12);
  assert.equal(rows[0].to.reps, 15);
  assert.equal(rows[0].to.weight, 25);
  assert.equal(typeof rows[0].key, 'string');
});

test('diffFromPlan ignores timer noise and breaks', () => {
  const run = (heldMs, breakMs) => {
    let s = start();
    s = endBreak(completeSet(s, {}, 0, fieldsOf), breakMs);        // break measured (≠ 60)
    s = endBreak(completeSet(s, {}, 0, fieldsOf), 60000);
    s = startSetTimer(s, 0);
    s = completeSet(s, {}, heldMs, fieldsOf);
    return diffFromPlan(s, fieldsOf);
  };
  assert.deepEqual(run(62000, 90000), []);
  const rows = run(75000, 60000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].planSetId, 'p1');
  assert.equal(rows[0].to.duration, 75);
});

test('diffFromPlan lists extra set and extra exercise; skipped never', () => {
  let s = start();
  s = endBreak(completeSet(s, {}, 0, fieldsOf), 60000);
  s = addSetToCurrent(s);
  s = endBreak(completeSet(s, {}, 0, fieldsOf), 60000);   // bench set 2 as planned
  s = endBreak(completeSet(s, { reps: 8 }, 0, fieldsOf), 60000); // extra bench set
  s = skipSet(s);                                         // plank skipped
  s = addExercise(s, 'curl');
  s = completeSet(s, { reps: 10, weight: 7.5 }, 0, fieldsOf);
  const rows = diffFromPlan(s, fieldsOf);
  assert.deepEqual(rows.map((r) => r.kind), ['extraSet', 'extraExercise']);
  assert.equal(rows[0].planItemId, 'pb');
  assert.equal(rows[0].to.reps, 8);
  assert.equal(rows[1].exerciseId, 'curl');
  assert.equal(rows[1].sets[0].weight, 7.5);
  assert.notEqual(rows[0].key, rows[1].key);
});

test('applyDiff overwrites by planSetId, appends extras, keeps break', () => {
  let n = 0;
  const makeId = () => `n${++n}`;
  const rows = [
    { key: '0:0', kind: 'changed', exerciseId: 'bench', planItemId: 'pb', planSetId: 'b1',
      from: { weight: 20, reps: 12, duration: null, break: 60 }, to: { weight: 25, reps: 15, duration: null, break: 99 } },
    { key: '0:2', kind: 'extraSet', exerciseId: 'bench', planItemId: 'pb', to: { weight: 20, reps: 8, duration: null, break: 60 } },
    { key: 'x2', kind: 'extraExercise', exerciseId: 'curl', sets: [{ weight: 7.5, reps: 10, duration: null, break: null }] },
  ];
  const before = plan();
  const out = applyDiff(before, rows, makeId);
  assert.deepEqual(out[0].sets[0], { id: 'b1', weight: 25, reps: 15, duration: null, break: 60 });
  assert.equal(out[0].sets.length, 3);
  assert.equal(out[0].sets[2].reps, 8);
  assert.ok(out[0].sets[2].id.startsWith('n'));
  assert.equal(out.length, 3);
  assert.equal(out[2].exerciseId, 'curl');
  assert.ok(out[2].id.startsWith('n') && out[2].sets[0].id.startsWith('n'));
  assert.equal(before[0].sets[0].weight, 20); // input untouched
});

test('applyDiff skips rows whose plan targets are gone', () => {
  const rows = [
    { key: '0:0', kind: 'changed', exerciseId: 'bench', planItemId: 'pb', planSetId: 'gone', from: {}, to: { weight: 1, reps: 1, duration: null, break: null } },
    { key: '0:2', kind: 'extraSet', exerciseId: 'bench', planItemId: 'gone', to: { weight: 1, reps: 1, duration: null, break: null } },
    { key: '1:0', kind: 'changed', exerciseId: 'plank', planItemId: 'pp', planSetId: 'p1', from: {}, to: { weight: null, reps: null, duration: 90, break: null } },
  ];
  const out = applyDiff(plan(), rows, () => 'x');
  assert.equal(out[0].sets.length, 2);
  assert.equal(out[0].sets[0].weight, 20);
  assert.equal(out[1].sets[0].duration, 90);
});

test('moveRemaining keeps a running timer and never moves the current item', () => {
  // plank first and running; bench + curl untouched behind it
  let s = start([
    { id: 'pp', exerciseId: 'plank', sets: [S('p1', { duration: 60 })] },
    { id: 'pb', exerciseId: 'bench', sets: [S('b1', { reps: 5 })] },
  ]);
  s = addExercise(s, 'curl');
  s = startSetTimer(s, 1000);
  const swapped = moveRemaining(s, 2, -1);
  assert.deepEqual(swapped.items.map((i) => i.exerciseId), ['plank', 'curl', 'bench']);
  assert.equal(swapped.run.timerStartedAt, 1000);
  assert.equal(currentSet(swapped).item.exerciseId, 'plank');
  const refused = moveRemaining(s, 0, 1); // current item can't move
  assert.deepEqual(refused.items.map((i) => i.exerciseId), ['plank', 'bench', 'curl']);
});

test('extra set row carries the target break, not the measured one', () => {
  let s = start([{ id: 'pb', exerciseId: 'bench', sets: [S('b1', { weight: 20, reps: 12, break: 60 })] }]);
  s = addSetToCurrent(s);                               // extra bench set copies break 60
  s = addExercise(s, 'curl');                           // so the extra set is not the last one
  s = endBreak(completeSet(s, {}, 0, fieldsOf), 500);
  s = endBreak(completeSet(s, { reps: 8 }, 1000, fieldsOf), 2000); // extra set; break skipped after 1s
  assert.equal(s.items[0].sets[1].actual.break, 1);      // measured break is logged
  s = completeSet(s, { reps: 10 }, 3000, fieldsOf);
  const rows = diffFromPlan(s, fieldsOf);
  assert.deepEqual(rows.map((r) => r.kind), ['extraSet', 'extraExercise']);
  assert.equal(rows[0].to.break, 60);                    // the plan gets the target, not 1
});

// ---------- plan 2b: circuits ----------
import { executionOrder, isCircuitStep, pause, resume, restartStepPaused, editDoneSet, tickCircuit } from '../js/session.js';

const CF = {
  pushups: { weight: false, reps: true, duration: true, break: true },
  plank: { weight: false, reps: false, duration: true, break: true },
  burpee: { weight: false, reps: true, duration: false, break: true },
  bench: { weight: true, reps: true, duration: false, break: false },
};
const cf = (id) => CF[id];
const mixed = () => [
  { id: 'c1', type: 'circuit', rounds: 2, items: [
    { id: 'ip', exerciseId: 'pushups', sets: [S('tp', { duration: 20, reps: 15, break: 10 })] },
    { id: 'ik', exerciseId: 'plank', sets: [S('tk', { duration: 20, break: 10 })] },
  ] },
  { id: 'ib', exerciseId: 'bench', sets: [S('tb', { weight: 20, reps: 12 })] },
];
const startMixed = (entries = mixed()) =>
  startSession({ planItems: entries, planDay: 'mon', date: '2026-11-23', startedAt: '2026-11-23T18:00:00', nowMs: 0 });

test('startSession with mixed entries', () => {
  const s = startMixed();
  assert.equal(s.items.length, 3);
  assert.equal(s.items[0].circuitId, 'c1');
  assert.equal(s.items[1].circuitId, 'c1');
  assert.equal(s.items[2].circuitId, null);
  assert.deepEqual(s.items[0].sets.map((x) => x.round), [1, 2]);
  assert.deepEqual(s.items[0].sets.map((x) => x.planSetId), ['tp', 'tp']);
  assert.equal(s.run.timerStartedAt, 0);
  assert.equal(s.run.pausedAt, null);
  assert.equal(isCircuitStep(s), true);
});

test('executionOrder is round-robin for circuits', () => {
  assert.deepEqual(executionOrder(startMixed()), [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0]]);
});

test('tickCircuit auto-ends work at target then runs the break then starts the next step', () => {
  let s = startMixed();
  assert.equal(tickCircuit(s, 19999, cf), s);
  s = tickCircuit(s, 20000, cf);
  assert.equal(s.items[0].sets[0].status, 'done');
  assert.equal(s.items[0].sets[0].actual.duration, 20);
  assert.equal(s.run.phase, 'break');
  assert.equal(s.run.timerStartedAt, 20000);
  s = tickCircuit(s, 30000, cf);
  assert.equal(s.items[0].sets[0].actual.break, 10);
  assert.deepEqual([s.run.itemIdx, s.run.setIdx, s.run.phase], [1, 0, 'set']);
  assert.equal(s.run.timerStartedAt, 30000);
});

test('tickCircuit catches up several steps with exact timestamps', () => {
  const s = tickCircuit(startMixed(), 65000, cf);
  assert.equal(s.items[0].sets[0].status, 'done');
  assert.equal(s.items[1].sets[0].status, 'done');
  assert.equal(s.items[1].sets[0].actual.break, 10);
  assert.equal(s.items[1].sets[0].actual.duration, 20);
  assert.deepEqual([s.run.itemIdx, s.run.setIdx, s.run.phase], [0, 1, 'set']);
  assert.equal(s.run.timerStartedAt, 60000);
});

test('tickCircuit waits on reps-only step', () => {
  const s = startMixed([{ id: 'c2', type: 'circuit', rounds: 2, items: [
    { id: 'iu', exerciseId: 'burpee', sets: [S('tu', { reps: 10, break: 10 })] },
  ] }]);
  assert.equal(tickCircuit(s, 600000, cf), s);
  const done = completeSet(s, { reps: 12 }, 5000, cf);   // Done tap
  assert.equal(done.run.phase, 'break');
  const next = tickCircuit(done, 15000, cf);              // break auto-ends
  assert.deepEqual([next.run.setIdx, next.run.phase], [1, 'set']);
});

test('tickCircuit leaves normal items alone', () => {
  const s = tickCircuit(startMixed(), 130000, cf); // circuit ends 110000, its last break 110–120, bench from 120000
  assert.equal(s.items[2].sets[0].status, 'pending');
  assert.equal(isCircuitStep(s), false);
  assert.equal(s.run.timerStartedAt, null);
  assert.equal(tickCircuit(s, 999999, cf), s);
});

test('last circuit step before a normal exercise still gets its break; final set of workout none', () => {
  const s = tickCircuit(startMixed(), 125000, cf); // plank r2 work 90–110, break 110–120, bench from 120000
  assert.equal(s.items[1].sets[1].actual.break, 10);
  assert.deepEqual([s.run.itemIdx, s.run.phase], [2, 'set']);
  const onlyCircuit = tickCircuit(startMixed([mixed()[0]]), 125000, cf); // plank r2 ends 110000, nothing after → no break
  assert.equal(onlyCircuit.run.phase, 'finished');
});

test('pause/resume freezes the clock', () => {
  let s = tickCircuit(startMixed(), 20000, cf);   // break started at 20000
  s = pause(s, 25000);
  assert.equal(s.run.pausedAt, 25000);
  assert.equal(tickCircuit(s, 85000, cf), s);
  s = resume(s, 85000);
  assert.equal(s.run.pausedAt, null);
  assert.equal(s.run.timerStartedAt, 80000);
  assert.equal(resume(s, 90000), s);              // not paused: no-op
});

test('restartStepPaused', () => {
  const mid = tickCircuit(startMixed(), 25000, cf);
  const r = restartStepPaused(mid, 500000);
  assert.equal(r.run.timerStartedAt, 500000);
  assert.equal(r.run.pausedAt, 500000);
  const normal = tickCircuit(startMixed(), 130000, cf);
  assert.equal(restartStepPaused(normal, 500000), normal);
});

test('editDoneSet only edits done sets', () => {
  const s = tickCircuit(startMixed(), 20000, cf);
  const e = editDoneSet(s, 0, 0, { reps: 17 });
  assert.equal(e.items[0].sets[0].actual.reps, 17);
  assert.equal(editDoneSet(s, 0, 1, { reps: 1 }), s);
});

test('diffFromPlan circuit row uses lowest done round', () => {
  let s = tickCircuit(startMixed(), 65000, cf);
  s = editDoneSet(s, 0, 0, { reps: 17 });
  s = tickCircuit(s, 80000, cf);                   // pushups r2 done at 80000
  s = editDoneSet(s, 0, 1, { reps: 14 });
  const rows = diffFromPlan(s, cf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'circuit');
  assert.equal(rows[0].planSetId, 'tp');
  assert.deepEqual(rows[0].rounds.map((r) => r.reps), [17, 14]);
  assert.equal(rows[0].to.reps, 14);
  assert.equal(rows[0].to.duration, 20);
  assert.equal(rows[0].to.break, 10);
});

test('applyDiff writes circuit row into nested item, weight/reps only', () => {
  const entries = mixed();
  const out = applyDiff(entries, [{ key: 'c0', kind: 'circuit', exerciseId: 'pushups', planItemId: 'ip', planSetId: 'tp',
    from: {}, rounds: [], to: { weight: null, reps: 14, duration: 99, break: 99 } }], () => 'x');
  assert.deepEqual(out[0].items[0].sets[0], { id: 'tp', weight: null, reps: 14, duration: 20, break: 10 });
  assert.equal(entries[0].items[0].sets[0].reps, 15);
});

test('addSetToCurrent and moveRemaining are no-ops on circuit items', () => {
  const s = startMixed();
  assert.equal(addSetToCurrent(s), s);
  const withExtra = addExercise(s, 'bench');
  assert.equal(moveRemaining(withExtra, 1, 1).items[1].exerciseId, 'plank'); // circuit item can't move
});

test('skipExercise in a circuit skips all remaining rounds of that exercise only', () => {
  const s = skipExercise(startMixed(), 1000);
  assert.deepEqual(s.items[0].sets.map((x) => x.status), ['skipped', 'skipped']);
  assert.deepEqual(s.items[1].sets.map((x) => x.status), ['pending', 'pending']);
  assert.deepEqual([s.run.itemIdx, s.run.setIdx], [1, 0]);
  assert.equal(s.run.timerStartedAt, 1000);
});
