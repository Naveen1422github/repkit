// backup-view — the export / import part of settings. the file format and its checks live in backup.js;
// this module only converts images (Blob <-> data URL), downloads, and asks before replacing.
import { el, toast } from './ui.js';
import { store, invalidateSessions } from './ctx.js';
import { todayKey } from './dates.js';
import { twoTap } from './library.js';

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const workouts = (n) => `${n} ${n === 1 ? 'workout' : 'workouts'}`;
const sessionCount = (data) => Object.entries(data)
  .filter(([k, v]) => k.startsWith('sessions:') && Array.isArray(v))
  .reduce((n, [, v]) => n + v.length, 0);

async function exportFile() {
  try {
    const doc = await store.exportAll();
    for (const [k, v] of Object.entries(doc.data)) if (v instanceof Blob) doc.data[k] = await blobToDataUrl(v);
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' }));
    const a = el('a', { href: url, download: `repkit-backup-${todayKey()}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`exported ${workouts(sessionCount(doc.data))}`, 'success');
  } catch (e) { toast(`export failed: ${e.message}`, 'error'); }
}

// onRestored: called after a successful import (the app re-renders from the new data)
export function backupSection(onRestored) {
  const confirmArea = el('div', {});
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let doc;
    try { doc = JSON.parse(await file.text()); } catch { toast('that file is not a repkit backup', 'error'); return; }
    if (!doc?.data || typeof doc.data !== 'object') { toast('that file is not a repkit backup', 'error'); return; }
    try {
      for (const [k, v] of Object.entries(doc.data)) {
        if (k.startsWith('img:') && typeof v === 'string' && v.startsWith('data:')) doc.data[k] = await (await fetch(v)).blob();
      }
    } catch { toast('could not read the photos in that backup', 'error'); return; }
    confirmArea.replaceChildren(
      el('div', { class: 'settings-info' }, `replace everything on this phone with this backup? (${workouts(sessionCount(doc.data))})`),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', onClick: () => confirmArea.replaceChildren() }, 'cancel'),
        twoTap('replace', async () => {
          try {
            await store.importAll(doc);
            invalidateSessions();
            toast('backup restored', 'success');
            onRestored();
          } catch (e) { toast(e.message, 'error'); confirmArea.replaceChildren(); }
        })));
  });
  return el('div', { class: 'field' },
    el('span', { class: 'field-label' }, 'backup'),
    el('div', { class: 'modal-actions' },
      el('button', { class: 'btn-ghost', onClick: exportFile }, 'export'),
      el('button', { class: 'btn-ghost', onClick: () => fileInput.click() }, 'import')),
    fileInput, confirmArea,
    el('div', { class: 'settings-info' }, 'export saves everything (plan, workouts, photos) to a file. import replaces what is on this phone.'));
}
