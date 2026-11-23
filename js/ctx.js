// ctx — the one shared store instance + transient view state.
import { kv } from './db.js';
import { createStore } from './store.js';
import { todayKey, weekdayKey } from './dates.js';

export const store = createStore(kv);

// UI-only state; never persisted
export const view = {
  tab: 'go',                         // 'go' | 'plan' | 'library' | 'log' | 'reports'
  planDay: weekdayKey(todayKey()),   // day selected on the Plan tab
  libCat: 'all',                     // 'all' | categoryId (Library filter)
  showArchived: false,               // Library: show archived exercises
  openItemId: null,                  // Plan: expanded exercise card
};

let renderFn = () => {};
export const setRender = (fn) => { renderFn = fn; };
export const rerender = () => renderFn();

export const exerciseById = (id) => store.state.exercises.find((e) => e.id === id);
export const categoryName = (id) => store.state.categories.find((c) => c.id === id)?.name ?? '';
