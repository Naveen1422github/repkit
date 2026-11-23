// library — exercises + user categories.
import { el, icon, openModal, toast, onTapOrHold } from './ui.js';
import { store, view, rerender, categoryName } from './ctx.js';
import { FIELDS } from './store.js';
import { compressImage } from './images.js';

export const FIELD_LABEL = { weight: 'kg', reps: 'reps', duration: 'time', break: 'break' };
const FIELD_NAME = { weight: 'weight (kg)', reps: 'reps', duration: 'duration', break: 'break' };

// object URLs for thumbnails; revoked on every re-render so blobs don't leak
let thumbUrls = [];
function revokeThumbs() { thumbUrls.forEach((u) => URL.revokeObjectURL(u)); thumbUrls = []; }

export function thumb(imageKey, cls = 'rk-thumb') {
  const img = el('img', { class: cls, alt: '' });
  if (!imageKey) return null;
  store.getImage(imageKey).then((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    thumbUrls.push(url);
    img.src = url;
  }).catch(() => {});
  return img;
}

async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg, 'success');
    return true;
  } catch (e) { toast(e.message, 'error'); return false; }
}

export function renderLibrary() {
  revokeThumbs();
  const wrap = el('div', { class: 'view-pad' });
  const cats = store.state.categories.filter((c) => !c.archived);
  if (view.libCat !== 'all' && !cats.some((c) => c.id === view.libCat)) view.libCat = 'all';

  const chips = el('div', { class: 'chips' });
  const chip = (id, label) => el('button', {
    class: 'chip' + (view.libCat === id ? ' active' : ''),
    onClick: () => { view.libCat = id; rerender(); },
  }, label);
  chips.appendChild(chip('all', 'all'));
  for (const c of cats) {
    const b = el('button', { class: 'chip' + (view.libCat === c.id ? ' active' : '') }, c.name);
    onTapOrHold(b, () => { view.libCat = c.id; rerender(); }, () => openCategorySheet(c));
    chips.appendChild(b);
  }
  chips.appendChild(el('button', { class: 'chip', 'aria-label': 'New category', onClick: () => openCategorySheet(null) }, icon('plus', 14)));
  wrap.appendChild(chips);
  if (cats.length) wrap.appendChild(el('div', { class: 'hint' }, 'hold a category to rename or archive it'));

  const visible = store.state.exercises
    .filter((e) => (view.showArchived ? true : !e.archived))
    .filter((e) => view.libCat === 'all' || e.categoryIds.includes(view.libCat))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!visible.length) {
    wrap.appendChild(el('div', { class: 'empty' }, el('div', { class: 'empty-text' },
      store.state.exercises.length ? 'no exercises here' : 'no exercises yet. add your first one.')));
  }
  for (const ex of visible) wrap.appendChild(exerciseRow(ex));

  wrap.appendChild(el('button', { class: 'btn-primary rk-wide', onClick: () => openExerciseSheet(null) }, '+ exercise'));
  if (store.state.exercises.some((e) => e.archived)) {
    wrap.appendChild(el('button', {
      class: 'link-btn',
      onClick: () => { view.showArchived = !view.showArchived; rerender(); },
    }, view.showArchived ? 'hide archived' : 'show archived'));
  }
  return wrap;
}

function exerciseRow(ex) {
  return el('button', { class: 'rk-ex-row' + (ex.archived ? ' archived' : ''), onClick: () => openExerciseSheet(ex.id) },
    thumb(ex.imageKey) || el('span', { class: 'rk-thumb rk-thumb-empty' }),
    el('span', { class: 'rk-ex-main' },
      el('span', { class: 'rk-row-name' }, ex.name + (ex.archived ? ' · archived' : '')),
      el('span', { class: 'rk-row-meta' }, ex.categoryIds.map(categoryName).filter(Boolean).join(', ') || 'no category')),
    el('span', { class: 'rk-badges' },
      ...FIELDS.filter((f) => ex.fields[f]).map((f) => el('span', { class: 'rk-badge' }, FIELD_LABEL[f]))),
  );
}

// ---------- category sheet (null = new) ----------
function openCategorySheet(cat) {
  openModal(cat ? 'category' : 'new category', (body, close) => {
    let name = cat?.name ?? '';
    const input = el('input', { class: 'input', type: 'text', value: name, maxlength: '40', placeholder: 'e.g. Chest', onInput: (e) => { name = e.target.value; } });
    const actions = el('div', { class: 'modal-actions' });
    body.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'name'), input), actions);
    setTimeout(() => input.focus(), 50);

    if (cat) {
      const inUse = store.state.exercises.some((e) => e.categoryIds.includes(cat.id));
      actions.append(twoTap(inUse ? 'archive' : 'delete', async () => {
        const ok = await run(() => (inUse ? store.archiveCategory(cat.id) : store.deleteCategory(cat.id)));
        if (ok) { close(); rerender(); }
      }));
    }
    actions.append(el('button', {
      class: 'btn-primary',
      onClick: async () => {
        const ok = await run(() => (cat ? store.renameCategory(cat.id, name) : store.addCategory(name)));
        if (ok) { close(); rerender(); }
      },
    }, 'save'));
  });
}

// a destructive button that needs a second tap to confirm (no confirm())
export function twoTap(label, onConfirm) {
  let armed = false;
  const b = el('button', { class: 'btn-danger-ghost' }, label);
  b.addEventListener('click', () => {
    if (!armed) { armed = true; b.textContent = `tap again to ${label}`; setTimeout(() => { armed = false; b.textContent = label; }, 3000); return; }
    onConfirm();
  });
  return b;
}

// ---------- exercise sheet (null = new). exported for plan 2's "add exercise" ----------
export function openExerciseSheet(exerciseId, { onSaved } = {}) {
  const ex = exerciseId ? store.state.exercises.find((e) => e.id === exerciseId) : null;
  openModal(ex ? 'edit exercise' : 'new exercise', (body, close) => {
    const f = {
      name: ex?.name ?? '',
      info: ex?.info ?? '',
      categoryIds: [...(ex?.categoryIds ?? (view.libCat !== 'all' ? [view.libCat] : []))],
      fields: { ...(ex?.fields ?? { weight: false, reps: false, duration: false, break: false }) },
    };
    // photo: undefined = unchanged, null = remove, File = replace
    let photo;

    const saveBtn = el('button', { class: 'btn-primary' }, 'save');
    const syncSave = () => { saveBtn.disabled = !FIELDS.some((k) => f.fields[k]); };

    // categories: multi-select + inline new
    const catChips = el('div', { class: 'chips' });
    const drawCats = () => {
      catChips.replaceChildren();
      for (const c of store.state.categories.filter((c) => !c.archived || f.categoryIds.includes(c.id))) {
        const on = f.categoryIds.includes(c.id);
        catChips.appendChild(el('button', {
          type: 'button', class: 'chip' + (on ? ' active' : ''),
          onClick: () => { f.categoryIds = on ? f.categoryIds.filter((x) => x !== c.id) : [...f.categoryIds, c.id]; drawCats(); },
        }, c.name));
      }
      const newInput = el('input', { class: 'input rk-inline-input', type: 'text', placeholder: 'new category', maxlength: '40' });
      const addNew = async () => {
        if (!newInput.value.trim()) return;
        try {
          const c = await store.addCategory(newInput.value);
          f.categoryIds.push(c.id);
          drawCats();
        } catch (e) { toast(e.message, 'error'); }
      };
      newInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addNew(); });
      catChips.appendChild(el('div', { class: 'rk-inline-new' }, newInput,
        el('button', { type: 'button', class: 'mini-btn', 'aria-label': 'Add category', onClick: addNew }, icon('plus', 14))));
    };
    drawCats();

    // fields to track
    const fieldChips = el('div', { class: 'chips' });
    for (const k of FIELDS) {
      const b = el('button', {
        type: 'button', class: 'chip' + (f.fields[k] ? ' active' : ''),
        onClick: () => { f.fields[k] = !f.fields[k]; b.classList.toggle('active', f.fields[k]); syncSave(); },
      }, FIELD_NAME[k]);
      fieldChips.appendChild(b);
    }

    // photo
    const preview = el('div', { class: 'rk-photo-preview' });
    const showPreview = (src) => {
      preview.replaceChildren();
      if (src) preview.appendChild(src);
    };
    if (ex?.imageKey) showPreview(thumb(ex.imageKey, 'rk-photo'));
    const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      photo = file;
      const url = URL.createObjectURL(file);
      thumbUrls.push(url);
      showPreview(el('img', { class: 'rk-photo', src: url, alt: '' }));
    });

    body.append(
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'name'),
        el('input', { class: 'input', type: 'text', value: f.name, maxlength: '60', onInput: (e) => { f.name = e.target.value; } })),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'info (optional)'),
        el('textarea', { class: 'input rk-textarea', rows: '2', maxlength: '500', onInput: (e) => { f.info = e.target.value; } }, f.info)),
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'categories'), catChips),
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'track (pick at least one)'), fieldChips),
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'photo (optional)'), preview,
        el('div', { class: 'rk-photo-actions' },
          el('button', { type: 'button', class: 'btn-ghost', onClick: () => fileInput.click() }, ex?.imageKey ? 'replace photo' : 'add photo'),
          ex?.imageKey ? el('button', { type: 'button', class: 'btn-ghost', onClick: () => { photo = null; showPreview(null); } }, 'remove photo') : null,
        ), fileInput),
    );

    const actions = el('div', { class: 'modal-actions' });
    if (ex) {
      const inPlan = Object.values(store.state.plan).some((d) => d.some((i) => i.exerciseId === ex.id));
      if (ex.archived) {
        actions.append(el('button', {
          class: 'btn-ghost',
          onClick: async () => { if (await run(() => store.updateExercise(ex.id, { archived: false }), 'restored')) { close(); rerender(); } },
        }, 'restore'));
      } else {
        actions.append(twoTap('archive', async () => { if (await run(() => store.archiveExercise(ex.id), 'archived')) { close(); rerender(); } }));
      }
      if (!inPlan) actions.append(twoTap('delete', async () => { if (await run(() => store.deleteExercise(ex.id), 'deleted')) { close(); rerender(); } }));
    }
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const payload = { name: f.name, info: f.info, categoryIds: f.categoryIds, fields: f.fields };
        const saved = ex ? (await store.updateExercise(ex.id, payload), ex) : await store.addExercise(payload);
        if (photo === null) await store.setExerciseImage(saved.id, null);
        else if (photo) {
          try {
            await store.setExerciseImage(saved.id, await compressImage(photo));
          } catch { toast('could not read that photo', 'error'); }
        }
        close();
        rerender();
        if (!(photo instanceof File)) toast(ex ? 'saved' : 'exercise added', 'success');
        onSaved?.(saved.id);
      } catch (e) {
        toast(e.message, 'error');
        syncSave();
      }
    });
    actions.append(saveBtn);
    body.append(actions);
    syncSave();
  });
}
