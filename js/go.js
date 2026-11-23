// go — the workout player. renders from store.state.active + Date.now(); all logic lives in session.js / timer.js.
import { el, icon, openModal, toast } from './ui.js';
import { store, rerender, exerciseById, invalidateSessions } from './ctx.js';
import { WEEKDAYS, todayKey, weekdayKey, nowTsSec } from './dates.js';
import { formatSec } from './timefmt.js';
import { elapsedSec, remainingSec, cuesBetween } from './timer.js';
import {
  startSession, currentSet, startSetTimer, completeSet, addBreakTime, endBreak, skipSet, skipExercise,
  addSetToCurrent, addExercise, moveRemaining, finish, diffFromPlan,
  executionOrder, isCircuitStep, pause, resume, restartStepPaused, editDoneSet, tickCircuit,
} from './session.js';
import { isCircuit, flatItems } from './planshape.js';
import { createSound } from './sound.js';
import { stepper } from './timepick.js';
import { setSummary, dayName } from './plan.js';
import { thumb, twoTap } from './library.js';

const sound = createSound();
const ALL_FIELDS = { weight: true, reps: true, duration: true, break: true };
const fieldsOf = (id) => exerciseById(id)?.fields ?? ALL_FIELDS;
const exName = (id) => exerciseById(id)?.name ?? 'unknown exercise';
const goView = { day: null }; // override day for the next start; null = today

// ---------- tick loop + wake lock ----------
let tickTimer = null;
let wakeLock = null;
function stopTick() { clearInterval(tickTimer); tickTimer = null; }

function ensureWake() {
  if (wakeLock || !navigator.wakeLock) return;
  navigator.wakeLock.request('screen').then((l) => {
    wakeLock = l;
    l.addEventListener('release', () => { wakeLock = null; });
  }).catch(() => {});
}
function releaseWake() { wakeLock?.release().catch(() => {}); wakeLock = null; }

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.state.active) ensureWake();
});

export function goTeardown() { stopTick(); releaseWake(); }

// compute() -> {rem|null, text, over}. tone: 'low' | 'high' | null (no cues)
function runClock(clockEl, compute, tone, onPaint) {
  let prevRem = compute().rem;
  const paint = () => {
    const r = compute();
    clockEl.textContent = r.text;
    clockEl.classList.toggle('over', !!r.over);
    if (tone && r.rem != null && prevRem != null) {
      for (const cue of cuesBetween(prevRem, r.rem, store.state.settings.countdownSec)) sound.play(cue, tone);
    }
    prevRem = r.rem;
    onPaint?.(r);
    // hands-free circuits: perform every step whose time has ended (also catches up after the app was hidden)
    const live = liveSession();
    if (live?.run) {
      const next = tickCircuit(live, Date.now(), fieldsOf);
      if (next !== live) { stopTick(); apply(next); }
    }
  };
  paint();
  tickTimer = setInterval(paint, 250);
}

// the newest session, including one still being written. handlers build from this, never from the
// render-time copy, so two quick taps (Done then skip, +15s twice) never undo each other.
let latest = null;
const liveSession = () => latest ?? store.state.active;

// every state change: compute next → persist → render. finished sessions are closed here.
// every caller is a tap, so it's also the moment to (re)unlock audio (resume, iOS screen lock).
async function apply(next) {
  sound.unlock();
  if (next.run?.phase === 'finished') next = finish(next, nowTsSec());
  latest = next;
  try {
    await store.saveActive(next);
    if (latest === next) latest = null;
  } catch (e) {
    toast(`not saved: ${e.message}`, 'error'); // keep `latest`: the next save retries with the newest state
  }
  rerender();
}

// clocks freeze while paused
const clockNow = (s) => s.run?.pausedAt ?? Date.now();

// after an app kill a circuit step restarts in full, paused (spec 6.3b). called once after boot.
export async function prepareResume() {
  const s = store.state.active;
  if (!s?.run) return;
  const next = restartStepPaused(s, Date.now());
  if (next !== s) { try { await store.saveActive(next); } catch { /* resuming unpaused is fine */ } }
}

function pauseButton(s) {
  const paused = s.run.pausedAt != null;
  return el('button', {
    class: paused ? 'btn-primary rk-big-btn' : 'btn-ghost rk-wide',
    onClick: () => { const live = liveSession(); apply(paused ? resume(live, Date.now()) : pause(live, Date.now())); },
  }, paused ? 'resume' : 'pause');
}

// ---------- entry ----------
export function renderGo() {
  stopTick();
  sound.setEnabled(store.state.settings.sound);
  const s = liveSession();
  if (!s) { releaseWake(); return renderStart(); }
  ensureWake();
  const wrap = el('div', { class: 'view-pad rk-go' + (s.run?.pausedAt != null ? ' rk-go-paused' : '') });
  if (s.run && store.state.settings.sound && !sound.unlocked()) {
    const banner = el('button', { class: 'rk-resume-banner', onClick: () => { sound.unlock(); banner.remove(); } }, 'tap to turn sound back on');
    wrap.appendChild(banner);
  }
  if (!s.run) wrap.appendChild(renderFinish(s));
  else if (s.run.phase === 'break') wrap.appendChild(renderBreak(s));
  else wrap.appendChild(renderSet(s));
  return wrap;
}

// ---------- before start ----------
function renderStart() {
  const today = weekdayKey(todayKey());
  const day = goView.day ?? today;
  const items = store.state.plan[day].filter((e) => !isCircuit(e) || e.items.length); // empty circuits aren't work
  const wrap = el('div', { class: 'view-pad' },
    el('div', { class: 'section-label' }, day === today ? `today · ${dayName(day)}` : `${dayName(day)} (instead of ${dayName(today)})`));
  if (!flatItems(items).length) {
    wrap.append(
      el('div', { class: 'empty' }, el('div', { class: 'empty-text' }, 'rest day')),
      el('button', { class: 'btn-ghost rk-wide', onClick: openDayPicker }, 'do a workout anyway'),
    );
    return wrap;
  }
  for (const it of items) {
    if (isCircuit(it)) {
      wrap.appendChild(el('div', { class: 'rk-row' },
        el('span', { class: 'rk-row-name' }, `circuit · ${it.rounds} ${it.rounds === 1 ? 'round' : 'rounds'}`),
        el('span', { class: 'rk-row-meta' }, it.items.map((i) => exName(i.exerciseId)).join(' → ') || 'empty')));
      continue;
    }
    const f = fieldsOf(it.exerciseId);
    const first = it.sets[0] ? setSummary(it.sets[0], f) : '';
    wrap.appendChild(el('div', { class: 'rk-row' },
      el('span', { class: 'rk-row-name' }, exName(it.exerciseId)),
      el('span', { class: 'rk-row-meta' }, `${it.sets.length} × ${first || 'set'}`)));
  }
  wrap.append(
    el('button', {
      class: 'btn-primary rk-big-btn',
      onClick: async () => {
        sound.unlock();
        const s = startSession({ planItems: items, planDay: day, date: todayKey(), startedAt: nowTsSec(), nowMs: Date.now() });
        goView.day = null;
        await apply(s);
      },
    }, 'start'),
    el('button', { class: 'link-btn rk-center', onClick: openDayPicker }, 'do a different day'),
  );
  return wrap;
}

function openDayPicker() {
  openModal('which day’s workout?', (body, close) => {
    body.append(el('div', { class: 'chips' }, ...WEEKDAYS.map((d) => el('button', {
      class: 'chip' + ((goView.day ?? weekdayKey(todayKey())) === d ? ' active' : ''),
      onClick: () => { goView.day = d; close(); rerender(); },
    }, d + (store.state.plan[d].length ? '' : ' · rest')))));
  });
}

// ---------- shared header ----------
function topBar(s) {
  const on = store.state.settings.sound;
  return el('div', { class: 'rk-go-top' },
    el('span', { class: 'rk-row-meta' }, `${dayName(s.planDay)} · started ${s.startedAt.slice(11, 16)}`),
    el('span', { class: 'rk-go-actions' },
      el('button', {
        class: 'icon-btn', 'aria-label': on ? 'Mute' : 'Unmute',
        onClick: async () => {
          sound.unlock();
          try { await store.updateSettings({ sound: !on }); } catch (e) { toast(e.message, 'error'); }
          rerender();
        },
      }, icon(on ? 'volume' : 'volumeOff', 18)),
      el('button', { class: 'icon-btn', 'aria-label': 'Workout menu', onClick: () => openMenu(s) }, icon('more', 18)),
    ));
}

const setPosition = (s, itemIdx, setIdx) => {
  const item = s.items[itemIdx];
  const set = item.sets[setIdx];
  return item.circuitId ? `round ${set.round} / ${item.sets.length}` : `set ${setIdx + 1} / ${item.sets.length}`;
};

// what comes after the current step (in a break the cursor set is already done)
function nextUp(s) {
  const pending = executionOrder(s).filter(([i, j]) => s.items[i].sets[j].status === 'pending');
  const next = s.run.phase === 'break' ? pending[0] : pending[1];
  return next ? `${exName(s.items[next[0]].exerciseId)} · ${setPosition(s, next[0], next[1])}` : 'finish';
}

const valuesText = (set, f) => [
  f.reps && set.actual.reps != null ? `${set.actual.reps} reps` : null,
  f.weight && set.actual.weight != null ? `${set.actual.weight} kg` : null,
].filter(Boolean).join(' · ');

// ---------- set screen ----------
function renderSet(s) {
  const cur = currentSet(s);
  const ex = exerciseById(cur.item.exerciseId);
  const f = fieldsOf(cur.item.exerciseId);
  const patch = {};
  const wrap = el('div', {}, topBar(s),
    el('div', { class: 'rk-go-title' },
      ex?.imageKey ? thumb(ex.imageKey, 'rk-go-thumb') : null,
      el('div', {},
        el('div', { class: 'rk-go-name' }, exName(cur.item.exerciseId)),
        el('div', { class: 'rk-row-meta' }, setPosition(s, cur.itemIdx, cur.setIdx) + (cur.set.planned ? '' : ' · extra')))),
    ex?.info ? el('details', { class: 'rk-go-info' }, el('summary', {}, 'info'), el('div', {}, ex.info)) : null,
  );

  const handsFree = cur.item.circuitId && f.duration && cur.set.actual.duration != null;
  if (handsFree) {
    const target = cur.set.actual.duration;
    const clock = el('div', { class: 'rk-clock' });
    const started = s.run.timerStartedAt ?? clockNow(s);
    wrap.append(
      s.run.pausedAt != null ? el('div', { class: 'rk-paused-label' }, 'paused') : '',
      clock,
      valuesText(cur.set, f) ? el('div', { class: 'rk-go-name rk-center' }, valuesText(cur.set, f)) : '',
      el('div', { class: 'rk-row-meta rk-center' }, `next: ${nextUp(s)}`),
      pauseButton(s),
    );
    runClock(clock, () => {
      const rem = Math.max(0, remainingSec(target, started, clockNow(s)));
      return { rem, text: formatSec(rem) };
    }, s.run.pausedAt != null ? null : 'low');
    return wrap;
  }
  if (f.duration) {
    const target = cur.set.actual.duration;
    const clock = el('div', { class: 'rk-clock' });
    wrap.appendChild(clock);
    const started = s.run.timerStartedAt;
    if (started == null) {
      clock.textContent = target == null ? '0:00' : formatSec(target);
      wrap.appendChild(el('button', {
        class: 'btn-ghost rk-wide',
        onClick: () => apply(startSetTimer(liveSession(), Date.now())),
      }, 'start set'));
    } else if (target == null) {
      runClock(clock, () => ({ rem: null, text: formatSec(elapsedSec(started, Date.now())) }), null);
    } else {
      runClock(clock, () => {
        const rem = remainingSec(target, started, Date.now());
        return { rem, text: formatSec(rem), over: rem < 0 };
      }, 'low');
    }
  }

  const values = el('div', { class: 'rk-go-values' },
    f.weight ? stepper({ value: cur.set.actual.weight, step: 2.5, unit: 'kg', onChange: (v) => { patch.weight = v; } }) : null,
    f.reps ? stepper({ value: cur.set.actual.reps, step: 1, unit: 'reps', onChange: (v) => { patch.reps = v; } }) : null,
  );
  if (values.childElementCount) wrap.appendChild(values);
  if (f.break && cur.set.actual.break != null) wrap.appendChild(el('div', { class: 'hint' }, `break after: ${formatSec(cur.set.actual.break)}`));

  wrap.appendChild(el('button', {
    class: 'btn-primary rk-big-btn',
    onClick: (e) => {
      e.currentTarget.disabled = true; // double-tap guard (completeSet is also a no-op outside phase 'set')
      apply(completeSet(liveSession(), patch, Date.now(), fieldsOf));
    },
  }, 'done'));
  return wrap;
}

// ---------- break screen ----------
// circuit break: fix reps/kg of the set that just ended without stopping the clock
function justNow(cur) {
  const f = fieldsOf(cur.item.exerciseId);
  if (!f.reps && !f.weight) return null;
  const edit = (patch) => {
    const next = editDoneSet(liveSession(), cur.itemIdx, cur.setIdx, patch);
    latest = next; // no re-render: the break clock keeps running
    store.saveActive(next).catch((e) => toast(e.message, 'error')).finally(() => { if (latest === next) latest = null; });
  };
  return el('div', { class: 'rk-just-now' },
    el('div', { class: 'rk-row-meta' }, `just now: ${exName(cur.item.exerciseId)}`),
    f.weight ? stepper({ value: cur.set.actual.weight, step: 2.5, unit: 'kg', onChange: (v) => edit({ weight: v }) }) : null,
    f.reps ? stepper({ value: cur.set.actual.reps, step: 1, unit: 'reps', onChange: (v) => edit({ reps: v }) }) : null);
}

function renderBreak(s) {
  const cur = currentSet(s);
  const inCircuit = !!cur.item.circuitId;
  const target = cur.set.actual.break;
  const clock = el('div', { class: 'rk-clock high' });
  const skipBtn = el('button', { class: 'btn-primary rk-big-btn', onClick: () => apply(endBreak(liveSession(), Date.now())) }, 'skip break');
  const wrap = el('div', {}, topBar(s),
    el('div', { class: 'rk-go-name rk-center' }, 'break'),
    clock,
    el('div', { class: 'rk-row-meta rk-center' }, `next: ${nextUp(s)}`),
    el('div', { class: 'rk-go-row' },
      el('button', { class: 'btn-ghost', onClick: () => apply(addBreakTime(liveSession(), 15)) }, '+15s'),
    ),
    inCircuit ? justNow(cur) : null,
    inCircuit && s.run.pausedAt != null ? el('div', { class: 'rk-paused-label' }, 'paused') : null,
    inCircuit ? pauseButton(s) : null,
    skipBtn,
  );
  runClock(clock, () => {
    const rem = remainingSec(target, s.run.timerStartedAt, clockNow(s), s.run.extraSec);
    return { rem, text: formatSec(rem), over: rem < 0 };
  }, s.run.pausedAt != null ? null : 'high', (r) => { skipBtn.textContent = r.rem <= 0 ? 'start next' : 'skip break'; });
  return wrap;
}

// ---------- menu ----------
function openMenu(s) {
  const at = `${s.run.itemIdx}:${s.run.setIdx}:${s.run.phase}`;
  const stillHere = () => {
    const r = liveSession()?.run;
    return !!r && `${r.itemIdx}:${r.setIdx}:${r.phase}` === at;
  };
  openModal('workout', (body, close) => {
    // a circuit keeps moving while the menu is open: never apply a choice to a different step
    const act = (fn) => () => {
      close();
      if (!stillHere()) { toast('the workout moved on — open the menu again', 'error'); rerender(); return; }
      apply(fn());
    };
    const inSet = s.run.phase === 'set';
    const circuit = isCircuitStep(s);
    body.append(el('div', { class: 'rk-menu' },
      inSet ? el('button', { class: 'btn-ghost', onClick: act(() => skipSet(liveSession(), Date.now())) }, circuit ? 'skip this round of it' : 'skip this set') : null,
      inSet ? el('button', { class: 'btn-ghost', onClick: act(() => skipExercise(liveSession(), Date.now())) }, circuit ? 'skip this exercise (all rounds)' : 'skip this exercise') : null,
      circuit ? null : el('button', { class: 'btn-ghost', onClick: act(() => addSetToCurrent(liveSession())) }, `add a set to ${exName(s.items[s.run.itemIdx].exerciseId)}`),
      circuit ? null : el('button', { class: 'btn-ghost', onClick: () => { close(); openAddExercise(s); } }, 'add an exercise'),
      circuit ? null : el('button', { class: 'btn-ghost', onClick: () => { close(); openReorder(); } }, 'reorder what’s left'),
      el('button', { class: 'btn-danger-ghost', onClick: () => { close(); openQuit(s); } }, 'quit workout'),
    ));
  });
}

function openAddExercise(s) {
  openModal('add an exercise', (body, close) => {
    let q = '';
    const list = el('div', { class: 'picker-list' });
    const draw = () => list.replaceChildren(...store.state.exercises
      .filter((e) => !e.archived && e.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => el('button', { class: 'picker-item', onClick: () => { close(); apply(addExercise(liveSession(), e.id)); } }, el('span', {}, e.name))));
    body.append(el('input', { class: 'input', type: 'search', placeholder: 'search', onInput: (e) => { q = e.target.value; draw(); } }), list);
    draw();
  });
}

function openReorder() {
  openModal('reorder what’s left', (body) => {
    const list = el('div', {});
    const draw = () => {
      const s = liveSession();
      if (!s?.run) return;
      const movable = s.items.map((it, i) => [it, i])
        .filter(([it, i]) => i !== s.run.itemIdx && it.sets.every((x) => x.status === 'pending'));
      list.replaceChildren(...movable.map(([it, i], k) => el('div', { class: 'rk-row' },
        el('span', { class: 'rk-row-name' }, exName(it.exerciseId)),
        el('span', {},
          el('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: k === 0, onClick: () => move(i, movable[k - 1]?.[1]) }, icon('chevronUp', 16)),
          el('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: k === movable.length - 1, onClick: () => move(i, movable[k + 1]?.[1]) }, icon('chevronDown', 16))))));
      if (!movable.length) list.appendChild(el('div', { class: 'empty-text' }, 'nothing left to reorder'));
    };
    const move = async (from, to) => {
      if (to == null) return;
      try { await store.saveActive(moveRemaining(liveSession(), from, to - from)); } catch (e) { toast(e.message, 'error'); }
      draw();
      rerender();
    };
    body.append(el('div', { class: 'hint' }, 'only exercises you haven’t started can move (not the current one)'), list);
    draw();
  });
}

function openQuit(s) {
  openModal('quit workout?', (body, close) => {
    body.append(el('div', { class: 'modal-actions rk-menu' },
      el('button', { class: 'btn-primary', onClick: () => { close(); apply(finish(liveSession(), nowTsSec(), { quit: true })); } }, 'save as partial'),
      twoTap('discard', async () => {
        close();
        try { await store.saveActive(null); latest = null; } catch (e) { toast(e.message, 'error'); }
        rerender();
      }),
    ));
  });
}

// ---------- finish screen ----------
function durationLabel(s) {
  const sec = Math.max(0, Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

const noBreak = (f) => ({ ...f, break: false });

function rowLabel(s, r) {
  const f = noBreak(fieldsOf(r.exerciseId));
  if (r.kind === 'circuit') {
    const parts = [];
    if (f.reps) parts.push(`reps ${r.from.reps ?? '–'} → ${r.rounds.map((x) => x.reps ?? '–').join(', ')} (plan: ${r.to.reps ?? '–'})`);
    if (f.weight) parts.push(`kg ${r.from.weight ?? '–'} → ${r.rounds.map((x) => x.weight ?? '–').join(', ')} (plan: ${r.to.weight ?? '–'})`);
    return [`${exName(r.exerciseId)} · circuit`, parts.join(' · ')];
  }
  if (r.kind === 'extraExercise') return [`${exName(r.exerciseId)} · new exercise`, `${r.sets.length} ${r.sets.length === 1 ? 'set' : 'sets'} · ${setSummary(r.sets[0], f)}`];
  const [i, j] = r.key.split(':').map(Number);
  const where = `${exName(r.exerciseId)} · set ${j + 1}`;
  if (r.kind === 'extraSet') return [`${where} · extra`, setSummary(r.to, f) || 'done'];
  return [where, `${setSummary(r.from, f) || '–'}  →  ${setSummary(r.to, f) || '–'}`];
}

function renderFinish(s) {
  const rows = diffFromPlan(s, fieldsOf);
  const chosen = new Set();
  const doneSets = s.items.reduce((n, it) => n + it.sets.filter((x) => x.status === 'done').length, 0);
  const allSets = s.items.reduce((n, it) => n + it.sets.length, 0);
  const wrap = el('div', {},
    el('div', { class: 'rk-go-name rk-center' }, s.status === 'partial' ? 'workout saved as partial' : 'workout done'),
    el('div', { class: 'rk-finish-stats' },
      el('div', {}, el('div', { class: 'rk-finish-num' }, durationLabel(s)), el('div', { class: 'rk-row-meta' }, 'time')),
      el('div', {}, el('div', { class: 'rk-finish-num' }, `${doneSets}/${allSets}`), el('div', { class: 'rk-row-meta' }, 'sets done'))),
  );
  if (!rows.length) {
    wrap.appendChild(el('div', { class: 'hint' }, 'matched the plan'));
  } else {
    wrap.appendChild(el('div', { class: 'section-label' }, 'changes from plan'));
    for (const r of rows) {
      const [title, detail] = rowLabel(s, r);
      const today = el('button', { class: 'chip active' }, 'today only');
      const update = el('button', { class: 'chip' }, 'update plan');
      const pick = (on) => {
        if (on) chosen.add(r.key); else chosen.delete(r.key);
        update.classList.toggle('active', on);
        today.classList.toggle('active', !on);
      };
      today.addEventListener('click', () => pick(false));
      update.addEventListener('click', () => pick(true));
      wrap.appendChild(el('div', { class: 'rk-change' },
        el('div', { class: 'rk-row-name' }, title),
        el('div', { class: 'rk-row-meta' }, detail),
        el('div', { class: 'chips' }, today, update)));
    }
  }
  wrap.appendChild(el('button', {
    class: 'btn-primary rk-big-btn',
    onClick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        await store.completeWorkout(s, rows.filter((r) => chosen.has(r.key)));
        latest = null;
        invalidateSessions();
        toast('workout saved', 'success');
      } catch (err) {
        toast(err.planNotUpdated ? 'workout saved, plan not updated' : `not saved: ${err.message}`, 'error');
        if (err.planNotUpdated) latest = null;
      }
      rerender();
    },
  }, 'save'));
  return wrap;
}
