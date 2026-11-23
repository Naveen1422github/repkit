// ctx — the one shared store instance + transient view state.
import { kv } from './db.js';
import { createStore } from './store.js';
import { todayKey, weekdayKey, monthKey } from './dates.js';
import { el, toast } from './ui.js';

export const store = createStore(kv);

// UI-only state; never persisted
export const view = {
  tab: 'go',                         // 'go' | 'plan' | 'library' | 'log' | 'reports'
  planDay: weekdayKey(todayKey()),   // day selected on the Plan tab
  libCat: 'all',                     // 'all' | categoryId (Library filter)
  showArchived: false,               // Library: show archived exercises
  openItemId: null,                  // Plan: expanded exercise card
  logMonth: monthKey(todayKey()),    // Log: month shown
  logDay: todayKey(),                // Log: selected day
  logEdit: false,                    // Log: edit mode for the selected day
  report: { seg: 'overview', period: 'week', exerciseId: null, cat: null },
};

let renderFn = () => {};
export const setRender = (fn) => { renderFn = fn; };
export const rerender = () => renderFn();

export const exerciseById = (id) => store.state.exercises.find((e) => e.id === id);
export const categoryName = (id) => store.state.categories.find((c) => c.id === id)?.name ?? '';

// past sessions for Log/Reports: draw at once from the last load, then refresh when the read lands
// (no "loading" flash on every re-render). call invalidateSessions() after writing a session.
let sessionsCache = null;
export const invalidateSessions = () => { sessionsCache = null; };
export function withSessions(render) {
  const host = el('div', {}, sessionsCache ? render(sessionsCache) : el('div', { class: 'hint' }, 'loading…'));
  store.allSessions().then((ss) => {
    const changed = !sessionsCache || JSON.stringify(ss) !== JSON.stringify(sessionsCache);
    sessionsCache = ss;
    if (changed && host.isConnected) host.replaceChildren(render(ss));
  }).catch((e) => toast(e.message, 'error'));
  return host;
}
