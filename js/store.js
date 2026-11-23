// store — app state + every read/write. the ONLY module that touches storage.
// storage is injected (kv = {get,set,del,keys}) so this file runs under node tests.
// rule: validate -> write kv -> only then update state. a failed write changes nothing.
import { todayKey, monthKey, monthsBetween, nowTsSec, WEEKDAYS } from './dates.js';
import { BACKUP_APP, validateBackup } from './backup.js';
import { applyDiff } from './session.js';
import { isCircuit, flatItems, findItem as findInDay, mapItems } from './planshape.js';

export const SCHEMA_VERSION = 1;
export const FIELDS = ['weight', 'reps', 'duration', 'break'];
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const K = {
  meta: 'meta', categories: 'categories', exercises: 'exercises',
  plan: 'plan', planHistory: 'planHistory', settings: 'settings', active: 'active',
  month: (mk) => `sessions:${mk}`,
  img: (exerciseId) => `img:${exerciseId}`,
};
const SEED_CATEGORIES = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio'];
const DEFAULT_SETTINGS = { sound: true, countdownSec: 3 };
const emptyPlan = () => Object.fromEntries(WEEKDAYS.map((d) => [d, []]));
const emptySet = (id) => ({ id, weight: null, reps: null, duration: null, break: null });

function cleanName(name) {
  const s = String(name ?? '').trim();
  if (!s) throw new Error('Name is required');
  return s;
}

function cleanFields(fields) {
  const f = Object.fromEntries(FIELDS.map((k) => [k, !!fields?.[k]]));
  if (!FIELDS.some((k) => f[k])) throw new Error('Pick at least one field');
  return f;
}

// a day counts as training only if it holds at least one exercise (an empty circuit isn't work)
const trainingDaysOf = (plan) => WEEKDAYS.filter((d) => flatItems(plan[d]).length > 0);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function createStore(kv, { today = todayKey, makeId = uid } = {}) {
  const state = {
    categories: [], exercises: [], plan: emptyPlan(), planHistory: [],
    settings: { ...DEFAULT_SETTINGS }, meta: { schemaVersion: SCHEMA_VERSION },
    active: null,
  };

  // ---------- boot ----------
  async function boot() {
    const meta = await kv.get(K.meta);
    if (meta && meta.schemaVersion > SCHEMA_VERSION) {
      throw new Error(`Data is from a newer app version (${meta.schemaVersion})`);
    }
    if (!meta) await kv.set(K.meta, { schemaVersion: SCHEMA_VERSION });
    state.meta = meta || { schemaVersion: SCHEMA_VERSION };

    let cats = await kv.get(K.categories);
    if (!cats) {
      cats = SEED_CATEGORIES.map((name) => ({ id: makeId(), name, archived: false }));
      await kv.set(K.categories, cats);
    }
    state.categories = cats;
    state.exercises = (await kv.get(K.exercises)) || [];
    state.plan = { ...emptyPlan(), ...((await kv.get(K.plan)) || {}) };
    state.planHistory = (await kv.get(K.planHistory)) || [];
    state.settings = { ...DEFAULT_SETTINGS, ...((await kv.get(K.settings)) || {}) };
    state.active = (await kv.get(K.active)) ?? null;
  }

  // ---------- categories ----------
  async function saveCategories(next) {
    await kv.set(K.categories, next);
    state.categories = next;
  }
  async function addCategory(name) {
    const cat = { id: makeId(), name: cleanName(name), archived: false };
    await saveCategories([...state.categories, cat]);
    return cat;
  }
  const patchCategory = (id, patch) =>
    saveCategories(state.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const renameCategory = (id, name) => patchCategory(id, { name: cleanName(name) });
  const archiveCategory = (id) => patchCategory(id, { archived: true });
  async function deleteCategory(id) {
    if (state.exercises.some((e) => e.categoryIds.includes(id))) throw new Error('Category is in use');
    await saveCategories(state.categories.filter((c) => c.id !== id));
  }

  // ---------- exercises ----------
  async function saveExercises(next) {
    await kv.set(K.exercises, next);
    state.exercises = next;
  }
  async function addExercise({ name, info = '', categoryIds = [], fields }) {
    const ex = {
      id: makeId(), name: cleanName(name), info: String(info ?? '').trim(),
      categoryIds: [...categoryIds], fields: cleanFields(fields), imageKey: null, archived: false,
    };
    await saveExercises([...state.exercises, ex]);
    return ex;
  }
  async function updateExercise(id, patch) {
    const clean = { ...patch };
    if ('name' in clean) clean.name = cleanName(clean.name);
    if ('info' in clean) clean.info = String(clean.info ?? '').trim();
    if ('fields' in clean) clean.fields = cleanFields(clean.fields);
    if ('categoryIds' in clean) clean.categoryIds = [...clean.categoryIds];
    await saveExercises(state.exercises.map((e) => (e.id === id ? { ...e, ...clean } : e)));
  }
  const archiveExercise = (id) => updateExercise(id, { archived: true });
  const isInPlan = (exerciseId) => WEEKDAYS.some((d) => flatItems(state.plan[d]).some((i) => i.exerciseId === exerciseId));
  const sessionUses = (s, exerciseId) => !!s && s.items.some((i) => i.exerciseId === exerciseId);
  async function isInHistory(exerciseId) {
    if (sessionUses(state.active, exerciseId)) return true;
    for (const key of await kv.keys('sessions:')) {
      if (((await kv.get(key)) || []).some((s) => sessionUses(s, exerciseId))) return true;
    }
    return false;
  }
  async function deleteExercise(id) {
    if (isInPlan(id) || await isInHistory(id)) throw new Error('Exercise is in use');
    const ex = state.exercises.find((e) => e.id === id);
    await saveExercises(state.exercises.filter((e) => e.id !== id));
    if (ex?.imageKey) await kv.del(ex.imageKey);
  }

  // ---------- images ----------
  async function setExerciseImage(id, blob) {
    const key = K.img(id);
    if (blob) await kv.set(key, blob);
    else await kv.del(key);
    await updateExercise(id, { imageKey: blob ? key : null });
  }
  const getImage = async (imageKey) => (imageKey ? (await kv.get(imageKey)) ?? null : null);

  // ---------- plan ----------
  // every plan write goes through here: plan + (maybe) planHistory, state only after both land.
  async function savePlan(next) {
    const days = trainingDaysOf(next);
    const hist = state.planHistory;
    const last = hist.at(-1);
    let nextHist = hist;
    if (!last ? days.length > 0 : !sameList(last.trainingDays, days)) {
      const entry = { from: today(), trainingDays: days };
      nextHist = last && last.from === entry.from ? [...hist.slice(0, -1), entry] : [...hist, entry];
    }
    await kv.set(K.plan, next);
    if (nextHist !== hist) await kv.set(K.planHistory, nextHist);
    state.plan = next;
    state.planHistory = nextHist;
  }
  const withDay = (day, fn) => savePlan({ ...state.plan, [day]: fn(state.plan[day]) });
  // items may sit at day level or inside a circuit (planshape)
  const findItem = (day, itemId) => {
    const found = findInDay(state.plan[day], itemId);
    if (!found) throw new Error('Plan item not found');
    return found;
  };
  const withItem = (day, itemId, fn) => withDay(day, (entries) => mapItems(entries, itemId, fn));
  const newItem = (exerciseId) => ({ id: makeId(), exerciseId, sets: [emptySet(makeId())] });

  async function addPlanItem(day, exerciseId) {
    const item = newItem(exerciseId);
    await withDay(day, (entries) => [...entries, item]);
    return item;
  }
  // removes a day-level entry (exercise or whole circuit) or one exercise inside a circuit
  const removePlanItem = (day, id) => withDay(day, (entries) => entries
    .filter((e) => e.id !== id)
    .map((e) => (isCircuit(e) && e.items.some((i) => i.id === id) ? { ...e, items: e.items.filter((i) => i.id !== id) } : e)));
  // moves within the containing list: the day, or the circuit's items
  async function movePlanItem(day, id, delta) {
    const swap = (list) => {
      const from = list.findIndex((x) => x.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return null;
      const next = [...list];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    };
    const entries = state.plan[day];
    const top = swap(entries);
    if (top) return withDay(day, () => top);
    const host = entries.find((e) => isCircuit(e) && e.items.some((i) => i.id === id));
    const inner = host && swap(host.items);
    if (inner) await withDay(day, (es) => es.map((e) => (e.id === host.id ? { ...e, items: inner } : e)));
  }
  async function addSet(day, itemId) {
    const { item, circuit } = findItem(day, itemId);
    if (circuit) throw new Error('Circuit exercises have one set; change rounds instead');
    const last = item.sets.at(-1);
    const set = last ? { ...last, id: makeId() } : emptySet(makeId());
    await withItem(day, itemId, (i) => ({ ...i, sets: [...i.sets, set] }));
    return set;
  }
  const updateSet = (day, itemId, setId, patch) =>
    withItem(day, itemId, (i) => ({ ...i, sets: i.sets.map((s) => (s.id === setId ? { ...s, ...patch, id: s.id } : s)) }));
  async function removeSet(day, itemId, setId) {
    if (findItem(day, itemId).item.sets.length <= 1) throw new Error('An exercise needs at least one set — this is its only set');
    await withItem(day, itemId, (i) => ({ ...i, sets: i.sets.filter((s) => s.id !== setId) }));
  }
  const copyItem = (i) => ({ id: makeId(), exerciseId: i.exerciseId, sets: i.sets.map((s) => ({ ...s, id: makeId() })) });
  const copyDay = (from, to) =>
    withDay(to, () => state.plan[from].map((e) => (isCircuit(e)
      ? { id: makeId(), type: 'circuit', rounds: e.rounds, items: e.items.map(copyItem) }
      : copyItem(e))));

  // ---------- circuits ----------
  async function addCircuit(day) {
    const circuit = { id: makeId(), type: 'circuit', rounds: 3, items: [] };
    await withDay(day, (entries) => [...entries, circuit]);
    return circuit;
  }
  async function setCircuitRounds(day, circuitId, rounds) {
    if (!Number.isInteger(rounds) || rounds < 1) throw new Error('Rounds must be 1 or more');
    await withDay(day, (entries) => entries.map((e) => (e.id === circuitId ? { ...e, rounds } : e)));
  }
  async function addCircuitItem(day, circuitId, exerciseId) {
    if (!state.plan[day].some((e) => e.id === circuitId && isCircuit(e))) throw new Error('Circuit not found');
    const item = newItem(exerciseId);
    await withDay(day, (entries) => entries.map((e) => (e.id === circuitId ? { ...e, items: [...e.items, item] } : e)));
    return item;
  }

  // ---------- workouts ----------
  // the in-progress session, written after every tap so a killed app resumes exactly here
  async function saveActive(session) {
    if (session) await kv.set(K.active, session);
    else await kv.del(K.active);
    state.active = session ?? null;
  }
  const loadSessions = async (mk) => (await kv.get(K.month(mk))) || [];

  // 1) session to its month (if this fails nothing changed) 2) chosen plan updates 3) clear active.
  // if 2 fails the workout is still saved; the error is rethrown so the UI can say "plan not updated".
  async function completeWorkout(session, rowsToApply = []) {
    const key = K.month(monthKey(session.date));
    await kv.set(key, [...(await loadSessions(monthKey(session.date))), session]);
    let planError = null;
    if (rowsToApply.length) {
      try {
        await savePlan({ ...state.plan, [session.planDay]: applyDiff(state.plan[session.planDay], rowsToApply, makeId) });
      } catch (e) { planError = e; }
    }
    await saveActive(null);
    if (planError) { planError.planNotUpdated = true; throw planError; }
  }

  // ---------- past sessions (log + reports) ----------
  const byStart = (a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0);
  async function loadSessionsRange(from, to) {
    const out = [];
    for (const mk of monthsBetween(from, to)) out.push(...(await loadSessions(mk)).filter((x) => x.date >= from && x.date <= to));
    return out.sort(byStart);
  }
  async function allSessions() {
    const out = [];
    for (const key of await kv.keys('sessions:')) out.push(...((await kv.get(key)) || []));
    return out.sort(byStart);
  }
  async function updateSession(session) {
    const key = K.month(monthKey(session.date));
    const list = (await kv.get(key)) || [];
    if (!list.some((x) => x.id === session.id)) throw new Error('Workout not found');
    await kv.set(key, list.map((x) => (x.id === session.id ? session : x)));
  }
  async function deleteSession(session) {
    const key = K.month(monthKey(session.date));
    await kv.set(key, ((await kv.get(key)) || []).filter((x) => x.id !== session.id));
  }

  // ---------- backup ----------
  // every kv key as-is (Blobs stay Blobs; the UI turns them into data URLs for the file)
  async function exportAll() {
    const data = {};
    for (const key of await kv.keys('')) data[key] = await kv.get(key);
    return { app: BACKUP_APP, schemaVersion: SCHEMA_VERSION, exportedAt: nowTsSec(), data };
  }
  // validate first: an invalid file changes nothing. then replace everything (never an active workout) and re-boot.
  async function importAll(doc) {
    const checked = validateBackup(doc, SCHEMA_VERSION);
    if (!checked.ok) throw new Error(checked.error);
    for (const key of await kv.keys('')) await kv.del(key);
    for (const [key, value] of Object.entries(checked.data)) if (key !== K.active) await kv.set(key, value);
    await boot();
  }

  // ---------- settings ----------
  async function updateSettings(patch) {
    const next = { ...state.settings, ...patch };
    await kv.set(K.settings, next);
    state.settings = next;
  }

  // every public write runs one at a time: each builds its next value from the state the
  // previous write left (e.g. a blur-commit of "20 kg" followed instantly by a "+ set" tap).
  // internal calls use the raw functions, so a queued write never waits on itself.
  let queue = Promise.resolve();
  const serial = (fn) => (...args) => {
    const run = queue.then(() => fn(...args));
    queue = run.catch(() => {});
    return run;
  };

  return {
    state, boot, getImage, loadSessions, loadSessionsRange, allSessions, exportAll,
    ...Object.fromEntries(Object.entries({
      addCategory, renameCategory, archiveCategory, deleteCategory,
      addExercise, updateExercise, archiveExercise, deleteExercise,
      setExerciseImage,
      addPlanItem, removePlanItem, movePlanItem, addSet, updateSet, removeSet, copyDay,
      addCircuit, setCircuitRounds, addCircuitItem,
      updateSettings, saveActive, completeWorkout, updateSession, deleteSession, importAll,
    }).map(([name, fn]) => [name, serial(fn)])),
  };
}
