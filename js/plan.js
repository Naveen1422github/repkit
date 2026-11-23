// plan — Mon–Sun weekly plan: exercises per day, sets per exercise.
import { el, icon, openModal, toast } from './ui.js';
import { store, view, rerender, exerciseById, categoryName } from './ctx.js';
import { WEEKDAYS, todayKey, weekdayKey } from './dates.js';
import { formatSec } from './timefmt.js';
import { openTimePicker, stepper, BREAK_CHIPS, DURATION_CHIPS } from './timepick.js';
import { twoTap, openExerciseSheet } from './library.js';
import { isCircuit } from './planshape.js';

const NAMES = { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };
export const dayName = (d) => NAMES[d];

const save = async (fn) => {
  // always re-render: on failure the steppers must snap back to what is actually stored
  try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { rerender(); }
};

// one-line summary of a set, only ticked fields. e.g. "12×20kg · 0:45 · break 1:00"
export function setSummary(set, fields) {
  const parts = [];
  const w = fields.weight && set.weight != null ? `${set.weight}kg` : null;
  const r = fields.reps && set.reps != null ? `${set.reps}` : null;
  if (r && w) parts.push(`${r}×${w}`);
  else if (r) parts.push(`${r} reps`);
  else if (w) parts.push(w);
  if (fields.duration && set.duration != null) parts.push(formatSec(set.duration));
  if (fields.break && set.break != null) parts.push(`break ${formatSec(set.break)}`);
  return parts.join(' · ');
}

export function renderPlan() {
  const day = view.planDay;
  const today = weekdayKey(todayKey());
  const wrap = el('div', { class: 'view-pad' });

  wrap.appendChild(el('div', { class: 'rk-days' }, ...WEEKDAYS.map((d) => el('button', {
    class: 'rk-day' + (d === day ? ' active' : '') + (d === today ? ' today' : ''),
    onClick: () => { view.planDay = d; view.openItemId = null; rerender(); },
  }, d, store.state.plan[d].length ? el('span', { class: 'rk-day-dot' }) : null))));

  const items = store.state.plan[day];
  wrap.appendChild(el('div', { class: 'section-label' }, dayName(day)));
  if (!items.length) wrap.appendChild(el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, 'rest day')));
  items.forEach((entry, i) => wrap.appendChild(isCircuit(entry)
    ? circuitCard(day, entry, i, items.length)
    : itemCard(day, entry, i, items.length)));

  wrap.appendChild(el('div', { class: 'rk-plan-actions' },
    el('button', { class: 'btn-primary', onClick: () => openExercisePicker(day) }, '+ exercise'),
    el('button', {
      class: 'btn-ghost',
      onClick: () => save(async () => { const c = await store.addCircuit(day); view.openItemId = c.id; }),
    }, '+ circuit'),
    items.length ? el('button', { class: 'btn-ghost', onClick: () => openCopyDay(day) }, 'copy day to…') : null,
  ));
  return wrap;
}

function itemCard(day, item, index, count) {
  const ex = exerciseById(item.exerciseId);
  const fields = ex?.fields ?? { weight: true, reps: true, duration: true, break: true };
  const open = view.openItemId === item.id;
  const first = item.sets[0];
  const summary = `${item.sets.length} ${item.sets.length === 1 ? 'set' : 'sets'}` +
    (first && setSummary(first, fields) ? ` · ${setSummary(first, fields)}` : '');

  const card = el('div', { class: 'rk-card' + (ex?.archived ? ' archived' : '') });
  card.appendChild(el('div', { class: 'rk-card-head' },
    el('button', {
      class: 'rk-card-title',
      onClick: () => { view.openItemId = open ? null : item.id; rerender(); },
    },
      el('span', { class: 'rk-row-name' }, (ex?.name ?? 'unknown exercise') + (ex?.archived ? ' · archived' : '')),
      el('span', { class: 'rk-row-meta' }, summary)),
    el('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: index === 0, onClick: () => save(() => store.movePlanItem(day, item.id, -1)) }, icon('chevronUp', 16)),
    el('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: index === count - 1, onClick: () => save(() => store.movePlanItem(day, item.id, 1)) }, icon('chevronDown', 16)),
  ));
  if (!open) return card;

  const sets = el('div', { class: 'rk-sets' });
  item.sets.forEach((set, i) => sets.appendChild(setRow(day, item, set, i, fields)));
  card.append(sets, el('div', { class: 'rk-card-foot' },
    el('button', { class: 'btn-ghost', onClick: () => save(() => store.addSet(day, item.id)) }, '+ set'),
    twoTap('remove exercise', () => { view.openItemId = null; save(() => store.removePlanItem(day, item.id)); }),
  ));
  return card;
}

// inCircuit: the one set is the per-round template, so it can't be removed
function setRow(day, item, set, i, fields, inCircuit = false) {
  const upd = (patch) => save(() => store.updateSet(day, item.id, set.id, patch));
  const timeBtn = (key, label, chips) => el('button', {
    class: 'rk-time-btn',
    onClick: () => openTimePicker({ title: `${label} · ${inCircuit ? 'each round' : `set ${i + 1}`}`, value: set[key], chips, onPick: (sec) => upd({ [key]: sec }) }),
  }, el('span', { class: 'rk-time-label' }, label), el('span', { class: 'rk-time-val' }, set[key] == null ? '–' : formatSec(set[key])));

  return el('div', { class: 'rk-set' },
    inCircuit ? null : el('span', { class: 'rk-set-no' }, `${i + 1}`),
    el('div', { class: 'rk-set-fields' },
      fields.weight ? stepper({ value: set.weight, step: 2.5, unit: 'kg', onChange: (v) => upd({ weight: v }) }) : null,
      fields.reps ? stepper({ value: set.reps, step: 1, unit: 'reps', onChange: (v) => upd({ reps: v }) }) : null,
      fields.duration ? timeBtn('duration', 'time', DURATION_CHIPS) : null,
      fields.break ? timeBtn('break', 'break', BREAK_CHIPS) : null,
    ),
    inCircuit ? null : el('button', {
      class: 'icon-btn', 'aria-label': 'Remove set',
      disabled: item.sets.length === 1,
      onClick: () => save(() => store.removeSet(day, item.id, set.id)),
    }, icon('x', 14)),
  );
}

// a circuit: exercises with one per-round set each, run hands-free for N rounds (spec §6.3b)
const exNameOf = (id) => exerciseById(id)?.name ?? 'unknown exercise';
const moveBtns = (onMove, index, count) => [
  el('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: index === 0, onClick: () => onMove(-1) }, icon('chevronUp', 16)),
  el('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: index === count - 1, onClick: () => onMove(1) }, icon('chevronDown', 16)),
];

function circuitCard(day, circuit, index, count) {
  const open = view.openItemId === circuit.id;
  const names = circuit.items.map((i) => exNameOf(i.exerciseId)).join(' → ') || 'no exercises yet';
  const card = el('div', { class: 'rk-card rk-circuit' });
  card.appendChild(el('div', { class: 'rk-card-head' },
    el('button', { class: 'rk-card-title', onClick: () => { view.openItemId = open ? null : circuit.id; rerender(); } },
      el('span', { class: 'rk-row-name' }, `circuit · ${circuit.rounds} ${circuit.rounds === 1 ? 'round' : 'rounds'}`),
      el('span', { class: 'rk-row-meta' }, names)),
    ...moveBtns((d) => save(() => store.movePlanItem(day, circuit.id, d)), index, count),
  ));
  if (!open) return card;

  const body = el('div', { class: 'rk-sets' },
    el('div', { class: 'rk-circuit-rounds' },
      el('span', { class: 'rk-time-label' }, 'rounds'),
      stepper({ value: circuit.rounds, step: 1, min: 1, onChange: (v) => save(() => store.setCircuitRounds(day, circuit.id, Math.max(1, Math.round(v ?? 1)))) })),
    el('div', { class: 'hint' }, 'runs hands-free: each exercise’s time, then its break, then the next'));
  circuit.items.forEach((item, i) => {
    const ex = exerciseById(item.exerciseId);
    const fields = ex?.fields ?? { weight: true, reps: true, duration: true, break: true };
    body.append(
      el('div', { class: 'rk-circuit-item' + (ex?.archived ? ' archived' : '') },
        el('span', { class: 'rk-row-name' }, exNameOf(item.exerciseId) + (ex?.archived ? ' · archived' : '')),
        el('span', {},
          ...moveBtns((d) => save(() => store.movePlanItem(day, item.id, d)), i, circuit.items.length),
          el('button', { class: 'icon-btn', 'aria-label': 'Remove from circuit', onClick: () => save(() => store.removePlanItem(day, item.id)) }, icon('x', 14)))),
      setRow(day, item, item.sets[0], 0, fields, true),
    );
  });
  card.append(body, el('div', { class: 'rk-card-foot' },
    el('button', { class: 'btn-ghost', onClick: () => openExercisePicker(day, circuit.id) }, '+ exercise to circuit'),
    twoTap('remove circuit', () => { view.openItemId = null; save(() => store.removePlanItem(day, circuit.id)); }),
  ));
  return card;
}

// circuitId: add into that circuit instead of the day
function openExercisePicker(day, circuitId = null) {
  openModal(circuitId ? 'add to circuit' : `add to ${dayName(day)}`, (body, close) => {
    let q = '';
    let cat = 'all';
    const list = el('div', { class: 'picker-list' });
    const chips = el('div', { class: 'chips' });
    const add = (exerciseId) => {
      close();
      save(async () => {
        if (circuitId) { await store.addCircuitItem(day, circuitId, exerciseId); view.openItemId = circuitId; return; }
        const item = await store.addPlanItem(day, exerciseId);
        view.openItemId = item.id;
      });
    };
    const draw = () => {
      chips.replaceChildren(...['all', ...store.state.categories.filter((c) => !c.archived).map((c) => c.id)].map((id) =>
        el('button', { class: 'chip' + (cat === id ? ' active' : ''), onClick: () => { cat = id; draw(); } }, id === 'all' ? 'all' : categoryName(id))));
      const rows = store.state.exercises
        .filter((e) => !e.archived)
        .filter((e) => cat === 'all' || e.categoryIds.includes(cat))
        .filter((e) => e.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name));
      list.replaceChildren(...rows.map((e) => el('button', { class: 'picker-item', onClick: () => add(e.id) },
        el('span', {}, e.name),
        el('span', { class: 'picker-meta' }, e.categoryIds.map(categoryName).filter(Boolean).join(', ')))));
      if (!rows.length) list.appendChild(el('div', { class: 'empty-text' }, 'no exercises match'));
    };
    body.append(
      el('input', { class: 'input', type: 'search', placeholder: 'search', onInput: (e) => { q = e.target.value; draw(); } }),
      chips, list,
      el('button', {
        class: 'btn-ghost rk-wide',
        onClick: () => { close(); openExerciseSheet(null, { onSaved: (id) => add(id) }); },
      }, 'new exercise'),
    );
    draw();
  });
}

function openCopyDay(from) {
  openModal(`copy ${dayName(from)} to…`, (body, close) => {
    const status = el('div', { class: 'settings-info' }, 'tap a day. a day that already has exercises needs a second tap, and gets replaced.');
    let armed = null;
    const row = el('div', { class: 'chips' });
    for (const d of WEEKDAYS.filter((x) => x !== from)) {
      const filled = store.state.plan[d].length > 0;
      const b = el('button', { class: 'chip' }, d + (filled ? ' ●' : ''));
      b.addEventListener('click', () => {
        if (filled && armed !== d) {
          armed = d;
          status.textContent = `${dayName(d)} has exercises. tap ${d} again to replace them.`;
          return;
        }
        close();
        save(async () => { await store.copyDay(from, d); toast(`copied to ${dayName(d)}`, 'success'); });
      });
      row.appendChild(b);
    }
    body.append(row, status);
  });
}
