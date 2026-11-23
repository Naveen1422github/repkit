// reports — two views: overview (days, time, streak, volume by category) and one exercise (best set, vs plan).
import { el } from './ui.js';
import { store, view, rerender, exerciseById, categoryName, withSessions } from './ctx.js';
import { todayKey } from './dates.js';
import { formatSec } from './timefmt.js';
import { barChart, hBars } from './charts.js';
import {
  periodRange, previousPeriod, inRange, consistency, streak, totalSec, volumeByCategory, bestTrend, planVsActual,
} from './report-data.js';

const ALL = { weight: true, reps: true, duration: true, break: true };
const fieldsOf = (id) => exerciseById(id)?.fields ?? ALL;
const catLabel = (id) => (id === 'uncategorized' ? 'no category' : categoryName(id) || 'deleted category');

export function renderReports() {
  return withSessions(draw);
}

function chips(options, current, onPick) {
  return el('div', { class: 'chips' }, ...options.map(([key, label]) =>
    el('button', { class: 'chip' + (current === key ? ' active' : ''), onClick: () => onPick(key) }, label)));
}

function draw(sessions) {
  const r = view.report;
  const set = (patch) => { Object.assign(r, patch); rerender(); };
  const wrap = el('div', { class: 'view-pad' },
    el('div', { class: 'rk-report-controls' },
      chips([['overview', 'overview'], ['exercise', 'exercise']], r.seg, (seg) => set({ seg })),
      chips([['week', 'week'], ['month', 'month']], r.period, (period) => set({ period }))));
  wrap.appendChild(r.seg === 'overview' ? overview(sessions, r) : exercise(sessions, r));
  return wrap;
}

const hm = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const tile = (value, label) => el('div', { class: 'rk-tile' }, el('div', { class: 'rk-tile-num' }, value), el('div', { class: 'rk-row-meta' }, label));

function overview(sessions, r) {
  const today = todayKey();
  const { from, to } = periodRange(r.period, today);
  const prev = previousPeriod(r.period, today);
  const cur = inRange(sessions, from, to);
  const hist = store.state.planHistory;
  const c = consistency(sessions, hist, from, to, today);
  const out = el('div', {},
    el('div', { class: 'rk-tiles' },
      tile(c.planned ? `${c.done}/${c.planned}` : '–', 'days done'),
      tile(hm(totalSec(cur)), 'time'),
      tile(String(streak(sessions, hist, today)), 'streak')));

  const vol = volumeByCategory(cur, store.state.exercises);
  out.appendChild(el('div', { class: 'section-label' }, `volume by category · this ${r.period}`));
  if (!cur.length) {
    out.appendChild(el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, `no workouts this ${r.period} yet`)));
    return out;
  }
  if (!vol.length) {
    out.appendChild(el('div', { class: 'hint' }, 'no weighted sets this period (volume = kg × reps)'));
    return out;
  }
  const before = new Map(volumeByCategory(inRange(sessions, prev.from, prev.to), store.state.exercises).map((v) => [v.categoryId, v.kg]));
  const total = vol.reduce((n, v) => n + v.kg, 0);
  out.appendChild(hBars(vol.map((v) => {
    const b = before.get(v.categoryId);
    const delta = !b ? 'new' : `${v.kg >= b ? '▲' : '▼'} ${Math.round(Math.abs(v.kg - b) / b * 100)}%`;
    return {
      label: `${catLabel(v.categoryId)}  ${delta}`,
      value: v.kg,
      pct: (v.kg / total) * 100,
      onClick: () => { r.seg = 'exercise'; r.cat = v.categoryId; r.exerciseId = null; rerender(); },
    };
  }), (kg) => `${+kg.toFixed(1)} kg`));
  out.appendChild(el('div', { class: 'hint' }, 'tap a category to see its exercises'));
  return out;
}

const mainUnit = (fields) => (fields.weight ? 'weight' : fields.reps ? 'reps' : 'duration');
const fmtMain = (key, v) => (key === 'weight' ? `${v} kg` : key === 'reps' ? `${v} reps` : formatSec(v));

function exercise(sessions, r) {
  const used = new Set(sessions.flatMap((s) => s.items.filter((it) => it.sets.some((x) => x.status === 'done')).map((it) => it.exerciseId)));
  let list = store.state.exercises.filter((e) => used.has(e.id));
  if (r.cat) list = list.filter((e) => (r.cat === 'uncategorized' ? !e.categoryIds.length : e.categoryIds.includes(r.cat)));
  list.sort((a, b) => a.name.localeCompare(b.name));
  const out = el('div', {});
  if (r.cat) {
    out.appendChild(el('button', { class: 'chip active rk-cat-filter', onClick: () => { r.cat = null; rerender(); } }, `${catLabel(r.cat)}  ✕`));
  }
  if (!list.length) {
    out.appendChild(el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, 'no sets logged yet')));
    return out;
  }
  if (!list.some((e) => e.id === r.exerciseId)) r.exerciseId = list[0].id;
  const select = el('select', { class: 'input rk-select', onChange: (e) => { r.exerciseId = e.target.value; rerender(); } },
    ...list.map((e) => el('option', { value: e.id, selected: e.id === r.exerciseId ? 'selected' : null }, e.name)));
  out.appendChild(select);

  const id = r.exerciseId;
  const fields = fieldsOf(id);
  const key = mainUnit(fields);
  const count = r.period === 'week' ? 8 : 6;
  const trend = bestTrend(sessions, id, fieldsOf, r.period, count, todayKey());
  const nz = trend.map((b, i) => [b, i]).filter(([b]) => b.value > 0);
  out.appendChild(el('div', { class: 'section-label' }, `best set · last ${count} ${r.period}s`));
  out.appendChild(barChart({ bars: trend, onSelect: () => {} }));
  if (nz.length >= 2) {
    const [[a, ia], [b, ib]] = [nz[0], nz.at(-1)];
    out.appendChild(el('div', { class: 'hint' }, `${fmtMain(key, a.value)} → ${fmtMain(key, b.value)} over ${ib - ia} ${r.period}${ib - ia === 1 ? '' : 's'}`));
  } else if (nz.length === 1) {
    out.appendChild(el('div', { class: 'hint' }, `best: ${fmtMain(key, nz[0][0].value)}`));
  }

  const pva = planVsActual(sessions, id, fieldsOf);
  out.appendChild(el('div', { class: 'section-label' }, 'vs plan'));
  out.appendChild(el('div', { class: 'rk-pva' },
    el('span', { class: 'rk-pva-above' }, `above ${pva.above}`), ' · ',
    el('span', {}, `equal ${pva.equal}`), ' · ',
    el('span', { class: 'rk-pva-below' }, `below ${pva.below}`)));
  if (pva.streakAbove >= 3) {
    out.appendChild(el('div', { class: 'rk-hint-box' }, `you've beaten your plan ${pva.streakAbove} times in a row. raise it?`));
  }
  return out;
}
