// repkit — plan your week, run your workout set by set. vanilla JS modules, IndexedDB, no dependencies.
import { $, el, icon, attachSwipe, openModal, toast } from './ui.js';
import { store, view, setRender } from './ctx.js';
import { renderLibrary } from './library.js';
import { renderPlan } from './plan.js';
import { renderGo, goTeardown, prepareResume } from './go.js';
import { renderLog } from './log.js';
import { renderReports } from './reports.js';
import { backupSection } from './backup-view.js';

const TABS = ['go', 'plan', 'library', 'log', 'reports'];

function render() {
  const app = $('#app');
  if (view.tab !== 'go') goTeardown();
  // keep the scroll position across re-renders (copied from kharchly)
  const prevScroll = $('.content')?.scrollTop || 0;
  const prevWindowScroll = window.scrollY;
  app.innerHTML = '';
  app.appendChild(renderHeader());
  app.appendChild(renderTabs());
  const content = el('div', { class: 'content' });
  attachSwipe(content, (dir) => switchTab(dir === 'left' ? 1 : -1));
  content.appendChild(renderTab());
  app.appendChild(content);
  content.scrollTop = prevScroll;
  window.scrollTo(0, prevWindowScroll);
}

function renderTab() {
  if (view.tab === 'go') return renderGo();
  if (view.tab === 'plan') return renderPlan();
  if (view.tab === 'library') return renderLibrary();
  if (view.tab === 'log') return renderLog();
  return renderReports();
}


function renderHeader() {
  return el('div', { class: 'header' },
    el('div', { class: 'brand' },
      el('span', { class: 'brand-dot' }),
      el('span', { class: 'brand-text' }, 'repkit'),
    ),
    el('div', { class: 'header-actions' },
      el('button', { class: 'icon-btn', 'aria-label': 'Settings', onClick: openSettings }, icon('settings', 16)),
    ),
  );
}

function openSettings() {
  openModal('settings', (body, close) => {
    const draw = () => {
      const st = store.state.settings;
      const set = async (patch) => {
        try { await store.updateSettings(patch); } catch (e) { toast(e.message, 'error'); }
        draw();
        render();
      };
      body.replaceChildren(
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'sound during workouts'),
          el('div', { class: 'chips' },
            el('button', { class: 'chip' + (st.sound ? ' active' : ''), onClick: () => set({ sound: true }) }, 'on'),
            el('button', { class: 'chip' + (!st.sound ? ' active' : ''), onClick: () => set({ sound: false }) }, 'off'))),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'countdown beeps'),
          el('div', { class: 'chips' }, ...[3, 5].map((n) => el('button', {
            class: 'chip' + (st.countdownSec === n ? ' active' : ''), onClick: () => set({ countdownSec: n }),
          }, `last ${n} s`)))),
        backupSection(() => { close(); view.tab = 'plan'; render(); }),
        el('div', { class: 'settings-info' }, 'repkit · your data stays on this phone.'),
      );
    };
    draw();
  });
}

function renderTabs() {
  const t = el('div', { class: 'tabs' });
  for (const name of TABS) {
    t.appendChild(el('button', {
      class: 'tab' + (view.tab === name ? ' active' : ''),
      onClick: () => { view.tab = name; render(); },
    }, name));
  }
  return t;
}

function switchTab(delta) {
  const idx = TABS.indexOf(view.tab) + delta;
  if (idx < 0 || idx >= TABS.length) return;
  view.tab = TABS[idx];
  $('.content') && ($('.content').scrollTop = 0);
  render();
}

// ---------- PWA install banner (copied from kharchly) ----------
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  try { if (localStorage.getItem('repkit:install-dismissed')) return; } catch { /* storage blocked */ }
  if ($('.install-banner')) return;
  const banner = el('div', { class: 'install-banner' },
    el('div', { class: 'install-banner-text' }, 'install repkit', el('small', {}, 'works offline · adds to home screen')),
    el('button', {
      class: 'install-btn',
      onClick: async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') banner.remove();
        deferredInstallPrompt = null;
      },
    }, 'install'),
    el('button', {
      class: 'install-dismiss', 'aria-label': 'Dismiss',
      onClick: () => { try { localStorage.setItem('repkit:install-dismissed', '1'); } catch { /* ignore */ } banner.remove(); },
    }, icon('x', 14)),
  );
  document.body.appendChild(banner);
}

async function start() {
  setRender(render);
  try { await navigator.storage?.persist?.(); } catch { /* not supported — fine */ }
  await store.boot();
  if (store.state.active) { view.tab = 'go'; await prepareResume(); } // resume a workout in progress
  render();
}

start().catch((err) => {
  console.error(err);
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(el('div', { class: 'loading' }, `storage error: ${err.message}`));
});
