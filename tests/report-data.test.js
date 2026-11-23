import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trainingDaysOn, isPlanned, firstDayOf, byDay, dayStatus, streak, consistency,
  periodRange, previousPeriod, inRange, totalSec, sessionVolume, volumeByCategory,
  bestSet, bestTrend, planVsActual,
} from '../js/report-data.js';

process.env.TZ = 'Asia/Kolkata';

// 2026-11-02 and 2026-11-09/16/23/30 are Mondays
const HIST = [{ from: '2026-11-02', trainingDays: ['mon', 'wed', 'fri'] }];
const V = (v) => ({ weight: null, reps: null, duration: null, break: null, ...v });
const set = (actual, { planned = actual, status = 'done' } = {}) => ({ planned: planned && V(planned), actual: V(actual), status });
const sess = (date, { status = 'done', items = [], start = '18:00:00', end = '18:30:00' } = {}) =>
  ({ id: `${date}-${start}`, date, planDay: 'mon', startedAt: `${date}T${start}`, endedAt: `${date}T${end}`, status, items });
const item = (exerciseId, sets, circuitId = null) => ({ exerciseId, circuitId, planItemId: 'p', sets });

const FIELDS = {
  bench: { weight: true, reps: true, duration: false, break: true },
  pushups: { weight: false, reps: true, duration: true, break: true },
  plank: { weight: false, reps: false, duration: true, break: false },
  curl: { weight: true, reps: true, duration: false, break: false },
};
const fieldsOf = (id) => FIELDS[id];

test('trainingDaysOn picks the latest entry not after the day', () => {
  const h = [{ from: '2026-11-02', trainingDays: ['mon'] }, { from: '2026-11-15', trainingDays: ['mon', 'tue'] }];
  assert.deepEqual(trainingDaysOn(h, '2026-11-10'), ['mon']);
  assert.deepEqual(trainingDaysOn(h, '2026-11-17'), ['mon', 'tue']);
  assert.deepEqual(trainingDaysOn(h, '2026-11-01'), []);
});

test("planned days follow planHistory, not today's plan", () => {
  const h = [{ from: '2026-11-02', trainingDays: ['mon'] }, { from: '2026-11-15', trainingDays: ['mon', 'tue'] }];
  assert.equal(isPlanned(h, '2026-11-10'), false); // Tue before the change
  assert.equal(isPlanned(h, '2026-11-17'), true);  // Tue after
});

test('firstDayOf and byDay', () => {
  const ss = [sess('2026-11-11'), sess('2026-11-09'), sess('2026-11-09', { start: '07:00:00' })];
  assert.equal(firstDayOf(ss), '2026-11-09');
  assert.equal(firstDayOf([]), null);
  assert.equal(byDay(ss).get('2026-11-09').length, 2);
});

test('dayStatus', () => {
  const ctx = (sessionsOnDay) => ({ sessionsOnDay, planHistory: HIST, today: '2026-11-25', firstDay: '2026-11-09' });
  assert.equal(dayStatus('2026-11-09', ctx([sess('2026-11-09')])), 'done');
  assert.equal(dayStatus('2026-11-09', ctx([sess('2026-11-09', { status: 'partial' }), sess('2026-11-09')])), 'done');
  assert.equal(dayStatus('2026-11-11', ctx([sess('2026-11-11', { status: 'partial' })])), 'partial');
  assert.equal(dayStatus('2026-11-13', ctx([])), 'missed');        // Fri, planned, past
  assert.equal(dayStatus('2026-11-25', ctx([])), 'planned');       // Wed = today
  assert.equal(dayStatus('2026-11-27', ctx([])), 'upcoming');      // Fri, future
  assert.equal(dayStatus('2026-11-04', ctx([])), 'upcoming');      // Wed before firstDay
  assert.equal(dayStatus('2026-11-10', ctx([])), 'rest');          // Tue
});

test('nothing is missed before firstDay', () => {
  const opts = { sessionsOnDay: [], planHistory: HIST, today: '2026-11-25', firstDay: null };
  assert.equal(dayStatus('2026-11-23', opts), 'upcoming');
  assert.equal(streak([], HIST, '2026-11-25'), 0);
  assert.deepEqual(consistency([], HIST, '2026-11-01', '2026-11-30', '2026-11-25'), { done: 0, planned: 0 });
});

test('rest-day workout counts as done', () => {
  const ss = [sess('2026-11-23'), sess('2026-11-24')]; // Mon planned, Tue rest
  const opts = { sessionsOnDay: [ss[1]], planHistory: HIST, today: '2026-11-25', firstDay: '2026-11-23' };
  assert.equal(dayStatus('2026-11-24', opts), 'done');
  assert.equal(streak(ss, HIST, '2026-11-25'), 2);
  assert.deepEqual(consistency(ss, HIST, '2026-11-23', '2026-11-29', '2026-11-25'), { done: 2, planned: 2 });
});

test('streak', () => {
  const ss = [sess('2026-11-16'), sess('2026-11-18'), sess('2026-11-20')]; // Mon Wed Fri
  assert.equal(streak(ss, HIST, '2026-11-23'), 3);  // today Mon, not done yet: doesn't break
  assert.equal(streak([ss[0], ss[2]], HIST, '2026-11-23'), 1); // Wed missed
  assert.equal(streak([...ss, sess('2026-11-23')], HIST, '2026-11-23'), 4);
});

test('consistency over a range', () => {
  const ss = [sess('2026-11-16'), sess('2026-11-20')];
  // planned Mon/Wed/Fri 16–22 → 3 planned, 2 done
  assert.deepEqual(consistency(ss, HIST, '2026-11-16', '2026-11-22', '2026-11-25'), { done: 2, planned: 3 });
  // range into the future stops at today (Wed 25); today counts only once done → just Mon 23
  assert.deepEqual(consistency(ss, HIST, '2026-11-23', '2026-11-29', '2026-11-25'), { done: 0, planned: 1 });
});

test('periodRange/previousPeriod week and month', () => {
  assert.deepEqual(periodRange('week', '2026-11-25'), { from: '2026-11-23', to: '2026-11-29' });
  assert.deepEqual(previousPeriod('week', '2026-11-25'), { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(periodRange('month', '2026-11-25'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(previousPeriod('month', '2026-11-25'), { from: '2026-10-01', to: '2026-10-31' });
  const ss = [sess('2026-10-31'), sess('2026-11-01'), sess('2026-11-30')];
  assert.equal(inRange(ss, '2026-11-01', '2026-11-30').length, 2);
});

test('totalSec', () => {
  assert.equal(totalSec([sess('2026-11-23', { start: '18:00:00', end: '18:52:30' })]), 3150);
});

test('sessionVolume counts done sets with weight and reps, circuits too, skips skipped', () => {
  const s = sess('2026-11-23', { items: [
    item('bench', [set({ weight: 20, reps: 10 }), set({ weight: 20, reps: 10 }, { status: 'skipped' })]),
    item('curl', [set({ weight: 7.5, reps: 12 })], 'c1'),
    item('plank', [set({ duration: 60 })]),
  ] });
  assert.equal(sessionVolume(s, fieldsOf), 200 + 90);
});

test('volumeByCategory', () => {
  const exercises = [
    { id: 'bench', categoryIds: ['chest', 'arms'] },
    { id: 'plank', categoryIds: ['core'] },
    { id: 'curl', categoryIds: [] },
  ];
  const s = sess('2026-11-23', { items: [
    item('bench', [set({ weight: 20, reps: 10 }), set({ weight: 20, reps: 10 })]),
    item('plank', [set({ duration: 60 })]),
    item('curl', [set({ weight: 10, reps: 5 })]),
  ] });
  assert.deepEqual(volumeByCategory([s], exercises, fieldsOf), [
    { categoryId: 'chest', kg: 400 },
    { categoryId: 'arms', kg: 400 },
    { categoryId: 'uncategorized', kg: 50 },
  ]);
});

test('bestSet', () => {
  assert.deepEqual(bestSet([V({ weight: 20, reps: 12 }), V({ weight: 25, reps: 5 }), V({ weight: 25, reps: 8 })], FIELDS.bench),
    { weight: 25, reps: 8, duration: null });
  assert.deepEqual(bestSet([V({ reps: 15 }), V({ reps: 18 })], FIELDS.pushups).reps, 18);
  assert.deepEqual(bestSet([V({ duration: 60 }), V({ duration: 75 })], FIELDS.plank).duration, 75);
  assert.equal(bestSet([], FIELDS.bench), null);
});

test('bestTrend', () => {
  const ss = [
    sess('2026-11-09', { items: [item('bench', [set({ weight: 20, reps: 10 })])] }),
    sess('2026-11-16', { items: [item('bench', [set({ weight: 22.5, reps: 8 })])] }),
    sess('2026-11-23', { items: [item('bench', [set({ weight: 25, reps: 5 }), set({ weight: 20, reps: 10 })])] }),
  ];
  const t = bestTrend(ss, 'bench', fieldsOf, 'week', 8, '2026-11-25');
  assert.equal(t.length, 8);
  assert.deepEqual(t.slice(-3).map((b) => b.value), [20, 22.5, 25]);
  assert.ok(t.slice(0, 5).every((b) => b.value === 0));
  assert.equal(t.at(-1).key, '2026-11-23');
  assert.equal(t.at(-1).label, '23/11');
});

test('planVsActual', () => {
  const s = (date, reps) => sess(date, { items: [item('bench', [set({ weight: 20, reps }, { planned: { weight: 20, reps: 10 } })])] });
  const above = [s('2026-11-02', 12), s('2026-11-04', 10), s('2026-11-06', 11), s('2026-11-09', 12), s('2026-11-11', 13)];
  assert.deepEqual(planVsActual(above, 'bench', fieldsOf), { above: 4, equal: 1, below: 0, streakAbove: 3 });
  assert.equal(planVsActual([...above, s('2026-11-13', 8)], 'bench', fieldsOf).streakAbove, 0);
  // extra sets (planned null) ignored; majority per session, ties → equal
  const mixed = sess('2026-11-16', { items: [item('bench', [
    set({ weight: 20, reps: 12 }, { planned: { weight: 20, reps: 10 } }),
    set({ weight: 20, reps: 8 }, { planned: { weight: 20, reps: 10 } }),
    set({ weight: 30, reps: 30 }, { planned: null }),
  ])] });
  assert.deepEqual(planVsActual([mixed], 'bench', fieldsOf), { above: 0, equal: 1, below: 0, streakAbove: 0 });
});
