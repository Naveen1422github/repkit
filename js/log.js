// log — month calendar (done ● / partial ○ / missed ✕ / planned), streak, and the selected day's workouts.
import { el, icon, toast } from './ui.js';
import { store, view, rerender, exerciseById, withSessions, invalidateSessions } from './ctx.js';
import { todayKey, monthKey, addMonths, daysInMonth, parseDay, weekdayKey } from './dates.js';
import { byDay, firstDayOf, dayStatus, streak, totalSec } from './report-data.js';
import { setSummary, dayName } from './plan.js';
import { stepper } from './timepick.js';
import { twoTap } from './library.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MARK = { done: '●', partial: '○', missed: '✕' };
const ALL = { weight: true, reps: true, duration: true, break: true };
const fieldsOf = (id) => exerciseById(id)?.fields ?? ALL;
const exName = (id) => exerciseById(id)?.name ?? 'deleted exercise';
const pad = (n) => String(n).padStart(2, '0');

export function renderLog() {
  return withSessions(draw);
}

function draw(sessions) {
  const today = todayKey();
  const thisMonth = monthKey(today);
  if (view.logMonth > thisMonth) view.logMonth = thisMonth;
  const mk = view.logMonth;
  const days = byDay(sessions);
  const ctx = { planHistory: store.state.planHistory, today, firstDay: firstDayOf(sessions) };
  const [y, m] = mk.split('-').map(Number);

  const go = (delta) => () => { view.logMonth = addMonths(mk, delta); view.logEdit = false; rerender(); };
  const wrap = el('div', { class: 'view-pad' },
    el('div', { class: 'rk-log-head' },
      el('button', { class: 'icon-btn', 'aria-label': 'Previous month', onClick: go(-1) }, icon('chevronLeft', 18)),
      el('span', { class: 'rk-log-month' }, `${MONTHS[m - 1]} ${y}`),
      el('button', { class: 'icon-btn', 'aria-label': 'Next month', disabled: mk >= thisMonth, onClick: go(1) }, icon('chevronRight', 18)),
      el('span', { class: 'rk-log-streak' }, `streak ${streak(sessions, ctx.planHistory, today)}`)),
  );

  const grid = el('div', { class: 'rk-cal' }, ...['m', 't', 'w', 't', 'f', 's', 's'].map((d) => el('span', { class: 'rk-cal-dow' }, d)));
  const lead = (parseDay(`${mk}-01`).getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) grid.appendChild(el('span', {}));
  for (let d = 1; d <= daysInMonth(mk); d++) {
    const day = `${mk}-${pad(d)}`;
    const status = dayStatus(day, { ...ctx, sessionsOnDay: days.get(day) ?? [] });
    grid.appendChild(el('button', {
      class: `rk-cal-day ${status}` + (day === today ? ' today' : '') + (day === view.logDay ? ' selected' : ''),
      disabled: day > today,
      onClick: () => { view.logDay = day; view.logEdit = false; rerender(); },
    }, el('span', { class: 'rk-cal-num' }, String(d)), el('span', { class: 'rk-cal-mark' }, MARK[status] ?? '')));
  }
  wrap.appendChild(grid);
  wrap.appendChild(el('div', { class: 'rk-cal-legend' }, '● done · ○ partial · ✕ missed · underline = planned'));

  if (view.logDay && monthKey(view.logDay) === mk) wrap.appendChild(dayDetail(view.logDay, days.get(view.logDay) ?? [], ctx));
  return wrap;
}

function durationLabel(s) {
  const sec = totalSec([s]);
  const h = Math.floor(sec / 3600), mn = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${mn}m` : `${mn} min`;
}

function dayDetail(day, sessions, ctx) {
  const [, m, d] = day.split('-');
  const wrap = el('div', { class: 'rk-log-day' },
    el('div', { class: 'section-label' }, `${dayName(weekdayKey(day))} ${Number(d)} ${MONTHS[Number(m) - 1]}`));
  if (!sessions.length) {
    const st = dayStatus(day, { ...ctx, sessionsOnDay: [] });
    wrap.appendChild(el('div', { class: 'hint' }, st === 'missed' ? 'missed' : st === 'planned' ? 'planned for today' : 'rest day'));
    return wrap;
  }
  wrap.appendChild(el('button', {
    class: 'link-btn', onClick: () => { view.logEdit = !view.logEdit; rerender(); },
  }, view.logEdit ? 'done editing' : 'edit'));
  for (const s of sessions) wrap.appendChild(sessionCard(s, day));
  return wrap;
}

function sessionCard(s, day) {
  const instead = s.planDay !== weekdayKey(day) ? ` · instead of ${dayName(weekdayKey(day))}` : '';
  const card = el('div', { class: 'rk-card rk-log-session' },
    el('div', { class: 'rk-log-session-head' },
      el('span', { class: 'rk-row-name' }, `${dayName(s.planDay)}${instead}`),
      el('span', { class: 'rk-row-meta' }, durationLabel(s) + (s.status === 'partial' ? ' · partial' : ''))));

  s.items.forEach((item, i) => {
    const f = { ...fieldsOf(item.exerciseId), break: false };
    const row = el('div', { class: 'rk-log-item' },
      el('div', { class: 'rk-row-name' }, exName(item.exerciseId) + (item.circuitId ? ' · circuit' : '')));
    item.sets.forEach((x, j) => {
      const label = item.circuitId ? `r${x.round ?? j + 1}` : `${j + 1}`;
      if (view.logEdit && x.status === 'done' && (f.weight || f.reps)) {
        row.appendChild(el('div', { class: 'rk-log-set' }, el('span', { class: 'rk-set-no' }, label),
          f.weight ? stepper({ value: x.actual.weight, step: 2.5, unit: 'kg', onChange: (v) => editSet(s, i, j, { weight: v }) }) : null,
          f.reps ? stepper({ value: x.actual.reps, step: 1, unit: 'reps', onChange: (v) => editSet(s, i, j, { reps: v }) }) : null));
        return;
      }
      row.appendChild(el('div', { class: 'rk-log-set' + (x.status !== 'done' ? ' skipped' : '') },
        el('span', { class: 'rk-set-no' }, label),
        el('span', {}, x.status === 'done' ? (setSummary(x.actual, f) || 'done') : 'skipped')));
    });
    card.appendChild(row);
  });

  if (view.logEdit) {
    card.appendChild(el('div', { class: 'rk-card-foot' }, twoTap('delete workout', async () => {
      try { await store.deleteSession(s); invalidateSessions(); toast('workout deleted', 'success'); } catch (e) { toast(e.message, 'error'); }
      rerender();
    })));
  }
  return card;
}

async function editSet(s, itemIdx, setIdx, patch) {
  const next = structuredClone(s);
  Object.assign(next.items[itemIdx].sets[setIdx].actual, patch);
  try {
    await store.updateSession(next);
    Object.assign(s.items[itemIdx].sets[setIdx].actual, patch); // keep the cached copy in step without a reload flash
  } catch (e) { toast(e.message, 'error'); invalidateSessions(); rerender(); }
}
