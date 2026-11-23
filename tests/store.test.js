import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, SCHEMA_VERSION } from '../js/store.js';

process.env.TZ = 'Asia/Kolkata';

function memKv() {
  const m = new Map();
  let failNext = false;
  return {
    map: m,
    failNextSet() { failNext = true; },
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async set(k, v) {
      if (failNext) { failNext = false; throw new Error('disk full'); }
      m.set(k, structuredClone(v));
    },
    async del(k) { m.delete(k); },
    async keys(prefix = '') { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

async function fresh(day = '2026-11-23') {
  const kv = memKv();
  const clock = { day };
  let n = 0;
  const store = createStore(kv, { today: () => clock.day, makeId: () => `id${++n}` });
  await store.boot();
  return { kv, store, clock };
}

const ALL = { weight: true, reps: true, duration: false, break: true };

test('boot seeds 7 categories, empty plan, default settings', async () => {
  const { store } = await fresh();
  assert.deepEqual(store.state.categories.map((c) => c.name),
    ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio']);
  assert.deepEqual(Object.keys(store.state.plan), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  assert.ok(Object.values(store.state.plan).every((d) => d.length === 0));
  assert.deepEqual(store.state.settings, { sound: true, countdownSec: 3 });
  assert.deepEqual(store.state.planHistory, []);
});

test('boot reloads what was saved', async () => {
  const { kv, store } = await fresh();
  await store.addExercise({ name: 'Bench', info: '', categoryIds: [], fields: ALL });
  const again = createStore(kv, { today: () => '2026-11-23' });
  await again.boot();
  assert.equal(again.state.exercises.length, 1);
  assert.equal(again.state.categories.length, 7);
});

test('addExercise requires a name and at least one field', async () => {
  const { store } = await fresh();
  await assert.rejects(store.addExercise({ name: '  ', categoryIds: [], fields: ALL }), /Name is required/);
  await assert.rejects(
    store.addExercise({ name: 'X', categoryIds: [], fields: { weight: false, reps: false, duration: false, break: false } }),
    /Pick at least one field/,
  );
  const ex = await store.addExercise({ name: ' Bench Press ', categoryIds: [], fields: ALL });
  assert.equal(ex.name, 'Bench Press');
  assert.equal(ex.archived, false);
  assert.equal(ex.imageKey, null);
});

test('addPlanItem starts with one empty set; addSet copies previous values', async () => {
  const { store } = await fresh();
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  const item = await store.addPlanItem('mon', ex.id);
  assert.equal(item.sets.length, 1);
  const s1 = item.sets[0];
  assert.deepEqual({ ...s1, id: undefined }, { id: undefined, weight: null, reps: null, duration: null, break: null });
  await store.updateSet('mon', item.id, s1.id, { weight: 20, reps: 12, break: 60 });
  const s2 = await store.addSet('mon', item.id);
  assert.notEqual(s2.id, s1.id);
  assert.deepEqual({ ...s2, id: undefined }, { id: undefined, weight: 20, reps: 12, duration: null, break: 60 });
  assert.equal(store.state.plan.mon[0].sets.length, 2);
});

test('removeSet, movePlanItem, removePlanItem', async () => {
  const { store } = await fresh();
  const a = await store.addExercise({ name: 'A', categoryIds: [], fields: ALL });
  const b = await store.addExercise({ name: 'B', categoryIds: [], fields: ALL });
  const ia = await store.addPlanItem('mon', a.id);
  const ib = await store.addPlanItem('mon', b.id);
  await store.movePlanItem('mon', ib.id, -1);
  assert.deepEqual(store.state.plan.mon.map((i) => i.id), [ib.id, ia.id]);
  await store.movePlanItem('mon', ib.id, -1); // already first: no-op
  assert.deepEqual(store.state.plan.mon.map((i) => i.id), [ib.id, ia.id]);
  const extra = await store.addSet('mon', ia.id);
  await store.removeSet('mon', ia.id, extra.id);
  assert.equal(store.state.plan.mon[1].sets.length, 1);
  await store.removePlanItem('mon', ia.id);
  assert.deepEqual(store.state.plan.mon.map((i) => i.id), [ib.id]);
});

test('copyDay gives fresh ids', async () => {
  const { store } = await fresh();
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  const item = await store.addPlanItem('mon', ex.id);
  await store.updateSet('mon', item.id, item.sets[0].id, { reps: 10 });
  await store.copyDay('mon', 'tue');
  const mon = store.state.plan.mon, tue = store.state.plan.tue;
  assert.equal(tue.length, 1);
  assert.equal(tue[0].exerciseId, ex.id);
  assert.equal(tue[0].sets[0].reps, 10);
  const ids = (d) => d.flatMap((i) => [i.id, ...i.sets.map((s) => s.id)]);
  assert.ok(ids(tue).every((id) => !ids(mon).includes(id)));
});

test('updateExercise fields does not touch plan values', async () => {
  const { store } = await fresh();
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  const item = await store.addPlanItem('mon', ex.id);
  await store.updateSet('mon', item.id, item.sets[0].id, { weight: 20 });
  await store.updateExercise(ex.id, { fields: { ...ALL, weight: false } });
  assert.equal(store.state.exercises[0].fields.weight, false);
  assert.equal(store.state.plan.mon[0].sets[0].weight, 20);
  await assert.rejects(
    store.updateExercise(ex.id, { fields: { weight: false, reps: false, duration: false, break: false } }),
    /Pick at least one field/,
  );
});

test('archived exercise stays in plan', async () => {
  const { store } = await fresh();
  const ex = await store.addExercise({ name: 'Plank', categoryIds: [], fields: { ...ALL, duration: true } });
  await store.addPlanItem('mon', ex.id);
  await store.archiveExercise(ex.id);
  assert.equal(store.state.exercises[0].archived, true);
  assert.equal(store.state.plan.mon[0].exerciseId, ex.id);
});

test('deleteExercise/deleteCategory refuse when in use', async () => {
  const { store } = await fresh();
  const chest = store.state.categories[0];
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [chest.id], fields: ALL });
  await assert.rejects(store.deleteCategory(chest.id), /Category is in use/);
  await store.addPlanItem('mon', ex.id);
  await assert.rejects(store.deleteExercise(ex.id), /Exercise is in use/);
  const lone = await store.addExercise({ name: 'Lone', categoryIds: [], fields: ALL });
  await store.deleteExercise(lone.id);
  assert.equal(store.state.exercises.length, 1);
  const back = store.state.categories[1];
  await store.deleteCategory(back.id);
  assert.equal(store.state.categories.length, 6);
});

test('categories: add, rename, archive', async () => {
  const { store } = await fresh();
  const c = await store.addCategory(' Glutes ');
  assert.equal(c.name, 'Glutes');
  await store.renameCategory(c.id, 'Hips');
  assert.equal(store.state.categories.at(-1).name, 'Hips');
  await store.archiveCategory(c.id);
  assert.equal(store.state.categories.at(-1).archived, true);
  await assert.rejects(store.addCategory(''), /Name is required/);
});

test('images: set, get, remove', async () => {
  const { kv, store } = await fresh();
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  await store.setExerciseImage(ex.id, 'BLOB');
  const key = store.state.exercises[0].imageKey;
  assert.equal(key, `img:${ex.id}`);
  assert.equal(await store.getImage(key), 'BLOB');
  await store.setExerciseImage(ex.id, null);
  assert.equal(store.state.exercises[0].imageKey, null);
  assert.equal(kv.map.has(key), false);
});

test('planHistory: first item on mon appends {from: today, trainingDays:[mon]}', async () => {
  const { store } = await fresh('2026-11-23');
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  await store.addPlanItem('mon', ex.id);
  assert.deepEqual(store.state.planHistory, [{ from: '2026-11-23', trainingDays: ['mon'] }]);
});

test('planHistory: further edits same day replace, not append', async () => {
  const { store } = await fresh('2026-11-23');
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  await store.addPlanItem('mon', ex.id);
  await store.addPlanItem('tue', ex.id);
  assert.deepEqual(store.state.planHistory, [{ from: '2026-11-23', trainingDays: ['mon', 'tue'] }]);
});

test('planHistory: set edits that do not change training days add nothing', async () => {
  const { store, clock } = await fresh('2026-11-23');
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  const item = await store.addPlanItem('mon', ex.id);
  clock.day = '2026-11-30';
  await store.addSet('mon', item.id);
  await store.updateSet('mon', item.id, item.sets[0].id, { reps: 5 });
  assert.equal(store.state.planHistory.length, 1);
});

test('planHistory: change on a later day appends', async () => {
  const { store, clock } = await fresh('2026-11-23');
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  await store.addPlanItem('mon', ex.id);
  clock.day = '2026-11-30';
  await store.copyDay('mon', 'thu');
  assert.deepEqual(store.state.planHistory, [
    { from: '2026-11-23', trainingDays: ['mon'] },
    { from: '2026-11-30', trainingDays: ['mon', 'thu'] },
  ]);
});

test('a failed write leaves state unchanged', async () => {
  const { kv, store } = await fresh();
  kv.failNextSet();
  await assert.rejects(store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL }), /disk full/);
  assert.equal(store.state.exercises.length, 0);
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  kv.failNextSet();
  await assert.rejects(store.addPlanItem('mon', ex.id), /disk full/);
  assert.equal(store.state.plan.mon.length, 0);
  assert.deepEqual(store.state.planHistory, []);
});

test('boot refuses newer schemaVersion', async () => {
  const kv = memKv();
  await kv.set('meta', { schemaVersion: SCHEMA_VERSION + 1 });
  const store = createStore(kv);
  await assert.rejects(store.boot(), /newer app version/);
});

test('overlapping plan writes do not overwrite each other (blur commit then tap +set)', async () => {
  const { store } = await fresh();
  const ex = await store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  const item = await store.addPlanItem('mon', ex.id);
  // not awaited in between: the UI fires both before the first IndexedDB write lands
  const a = store.updateSet('mon', item.id, item.sets[0].id, { weight: 20 });
  const b = store.addSet('mon', item.id);
  const newSet = (await Promise.all([a, b]))[1];
  const sets = store.state.plan.mon[0].sets;
  assert.equal(sets.length, 2);
  assert.equal(sets[0].weight, 20);
  assert.equal(newSet.weight, 20);
  assert.equal(sets[1].weight, 20);
});

// ---------- plan 2: active workout + sessions ----------
import { startSession, completeSet, finish, diffFromPlan } from '../js/session.js';

async function withBenchPlan() {
  const ctx = await fresh('2026-11-23');
  const ex = await ctx.store.addExercise({ name: 'Bench', categoryIds: [], fields: ALL });
  const item = await ctx.store.addPlanItem('mon', ex.id);
  await ctx.store.updateSet('mon', item.id, item.sets[0].id, { weight: 20, reps: 12 });
  const s = startSession({ planItems: ctx.store.state.plan.mon, planDay: 'mon', date: '2026-11-23', startedAt: '2026-11-23T18:00:00' });
  return { ...ctx, ex, item, s };
}
const fieldsFor = (store) => (id) => store.state.exercises.find((e) => e.id === id)?.fields;

test('active round-trips through boot', async () => {
  const { kv, store, s } = await withBenchPlan();
  const running = { ...s, run: { ...s.run, phase: 'break', timerStartedAt: 1732380000123, extraSec: 15 } };
  await store.saveActive(running);
  const again = createStore(kv, { today: () => '2026-11-23' });
  await again.boot();
  assert.deepEqual(again.state.active, running);
});

test('saveActive(null) clears', async () => {
  const { kv, store, s } = await withBenchPlan();
  await store.saveActive(s);
  await store.saveActive(null);
  assert.equal(store.state.active, null);
  assert.equal(kv.map.has('active'), false);
});

test('completeWorkout writes month, applies rows to planDay, clears active', async () => {
  const { store, s } = await withBenchPlan();
  await store.saveActive(s);
  const done = finish(completeSet(s, { reps: 15 }, 0, fieldsFor(store)), '2026-11-23T18:20:00');
  const rows = diffFromPlan(done, fieldsFor(store));
  assert.equal(rows.length, 1);
  await store.completeWorkout(done, rows);
  const month = await store.loadSessions('2026-11');
  assert.equal(month.length, 1);
  assert.equal(month[0].items[0].sets[0].actual.reps, 15);
  assert.equal(store.state.plan.mon[0].sets[0].reps, 15);
  assert.equal(store.state.active, null);
});

test('completeWorkout with failing session write changes nothing', async () => {
  const { kv, store, s } = await withBenchPlan();
  await store.saveActive(s);
  const done = finish(completeSet(s, { reps: 15 }, 0, fieldsFor(store)), '2026-11-23T18:20:00');
  kv.failNextSet();
  await assert.rejects(store.completeWorkout(done, diffFromPlan(done, fieldsFor(store))), /disk full/);
  assert.deepEqual(await store.loadSessions('2026-11'), []);
  assert.equal(store.state.plan.mon[0].sets[0].reps, 12);
  assert.ok(store.state.active);
});

test('deleteExercise refuses when used in a past session or the active one', async () => {
  const { store, s, ex, item } = await withBenchPlan();
  await store.saveActive(s);
  await store.removePlanItem('mon', item.id);
  await assert.rejects(store.deleteExercise(ex.id), /Exercise is in use/);
  await store.completeWorkout(finish(s, '2026-11-23T18:20:00', { quit: true }), []);
  assert.equal(store.state.active, null);
  await assert.rejects(store.deleteExercise(ex.id), /Exercise is in use/);
});

// ---------- plan 2b: circuits ----------
async function withCircuit() {
  const ctx = await fresh('2026-11-23');
  const push = await ctx.store.addExercise({ name: 'Push-ups', categoryIds: [], fields: { weight: false, reps: true, duration: true, break: true } });
  const plank = await ctx.store.addExercise({ name: 'Plank', categoryIds: [], fields: { weight: false, reps: false, duration: true, break: true } });
  const c = await ctx.store.addCircuit('mon');
  const a = await ctx.store.addCircuitItem('mon', c.id, push.id);
  const b = await ctx.store.addCircuitItem('mon', c.id, plank.id);
  return { ...ctx, push, plank, c, a, b };
}

test('addCircuit + addCircuitItem + setCircuitRounds', async () => {
  const { kv, store, c } = await withCircuit();
  assert.equal(c.type, 'circuit');
  assert.equal(c.rounds, 3);
  await store.setCircuitRounds('mon', c.id, 4);
  await assert.rejects(store.setCircuitRounds('mon', c.id, 0), /Rounds must be 1 or more/);
  const again = createStore(kv, { today: () => '2026-11-23' });
  await again.boot();
  const circuit = again.state.plan.mon[0];
  assert.equal(circuit.rounds, 4);
  assert.equal(circuit.items.length, 2);
  assert.equal(circuit.items[0].sets.length, 1);
  assert.deepEqual(again.state.planHistory, [{ from: '2026-11-23', trainingDays: ['mon'] }]);
});

test('updateSet works inside a circuit', async () => {
  const { store, a } = await withCircuit();
  await store.updateSet('mon', a.id, a.sets[0].id, { duration: 20, reps: 15, break: 10 });
  assert.deepEqual({ ...store.state.plan.mon[0].items[0].sets[0], id: undefined },
    { id: undefined, weight: null, reps: 15, duration: 20, break: 10 });
});

test('addSet refuses on circuit item; removeSet refuses the only set', async () => {
  const { store, a } = await withCircuit();
  await assert.rejects(store.addSet('mon', a.id), /Circuit exercises have one set/);
  await assert.rejects(store.removeSet('mon', a.id, a.sets[0].id), /only set/);
});

test('removePlanItem removes a whole circuit or one item in it', async () => {
  const { store, c, a } = await withCircuit();
  await store.removePlanItem('mon', a.id);
  assert.equal(store.state.plan.mon[0].items.length, 1);
  await store.removePlanItem('mon', c.id);
  assert.equal(store.state.plan.mon.length, 0);
});

test('movePlanItem moves inside the circuit', async () => {
  const { store, b } = await withCircuit();
  await store.movePlanItem('mon', b.id, -1);
  assert.equal(store.state.plan.mon[0].items[0].id, b.id);
});

test('copyDay copies circuits with fresh ids', async () => {
  const { store } = await withCircuit();
  await store.copyDay('mon', 'thu');
  const ids = (entries) => entries.flatMap((e) => [e.id, ...(e.items || [e]).flatMap((i) => [i.id, ...i.sets.map((x) => x.id)])]);
  const mon = ids(store.state.plan.mon), thu = ids(store.state.plan.thu);
  assert.equal(store.state.plan.thu[0].type, 'circuit');
  assert.equal(store.state.plan.thu[0].items.length, 2);
  assert.ok(thu.every((id) => !mon.includes(id)));
});

test('deleteExercise refuses when used only inside a circuit', async () => {
  const { store, push } = await withCircuit();
  await assert.rejects(store.deleteExercise(push.id), /Exercise is in use/);
});
