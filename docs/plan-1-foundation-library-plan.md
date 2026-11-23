# repkit — Plan 1: Foundation + Library + Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installable PWA where the user creates categories and exercises (with chosen fields and an optional photo) and builds a Mon–Sun weekly plan with sets. The Go, Log and Reports tabs exist only as placeholders.

**Architecture:** Vanilla JS ES modules, no build step, same shape as kharchly. `store.js` takes an injected `kv` adapter, so it runs in Node tests against an in-memory map and in the browser against IndexedDB. Pure modules are unit-tested with `node --test`. UI modules are checked by hand on the phone.

**Tech Stack:** HTML/CSS/JS (ES2022 modules), IndexedDB, Service Worker, `node --test` (Node 22). Zero npm dependencies.

**Spec:** `repkit/docs/spec.md`. This plan covers §3–§6.2 and the app shell. Later plans: **Plan 2** Go (session, timer, sound, wake lock, finish/diff), **Plan 3** Log + Reports + Export/Import. Each is written after the previous one is built, so it builds on real code.

## Global Constraints

- Zero npm dependencies. `package.json` only sets `"type": "module"` and `"scripts": {"test": "node --test"}`.
- IndexedDB name **`repkit-db`**. Never rename it once deployed.
- Times are integer **seconds**. Weight is **kg** (decimals allowed). Every set field is optional: `null` means "not set".
- Dates go through `js/dates.js` (local time). Never use `toISOString()` for keys.
- `js/store.js` is the only module touching `kv`. Rule copied from kharchly: **validate → write kv → only then update state**. A failed write changes nothing.
- Exercises and categories that are in use are **archived, never hard-deleted**.
- UI language matches kharchly: dark theme, IBM Plex Mono for numbers, Plex Sans for text, lower-case copy, no emoji, no gradients or shadows, bottom-sheet modals (`openModal`). Repkit gets its own `--accent` (pick one clearly different from kharchly's green).
- Never call `alert` / `confirm` / `prompt`. Use two-tap buttons or in-modal choices.
- **No build commands. No `git add` / `commit` / `stash` / `reset`.** The user commits. Each task ends with a checkpoint instead.
- Tests: from the main Claude session, delegate test runs to a background subagent that reports pass/fail counts plus failures only (repo `CLAUDE.md`).
- kharchly (`frontend2/expense-tracker/`) is a **read-only** source to copy from. Never edit it.

## Review Focus

1. **Archived exercise still in a plan.** The Plan tab must still render it (dimmed, "archived" label), not crash or drop it. Pinned by Task 2 test `archived exercise stays in plan`.
2. **Unticking a field keeps the plan's stored values** (hidden, not wiped). Re-ticking brings them back. Pinned by Task 2 test `updateExercise fields does not touch plan values`.
3. **Many plan edits in one day produce one `planHistory` entry.** No entry is added when the set of training days didn't change. Pinned by Task 2 tests `planHistory`.
4. **A storage write fails mid-action.** An error toast is shown and state is unchanged. Pinned by Task 2 test `a failed write leaves state unchanged`.
5. **A huge or undecodable phone photo** (12 MP, HEIC on some iPhones). It must not freeze the app; if decoding fails, the photo is dropped with a toast and the exercise still saves. Pinned by the Task 3 `fitSize` tests and the Task 6 manual check.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `repkit/package.json` | ESM + test script | 1 |
| `repkit/js/db.js` | copied from kharchly, DB name `repkit-db` | 1 |
| `repkit/js/ui.js` | copied from kharchly unchanged | 1 |
| `repkit/js/dates.js` | copied from kharchly + `WEEKDAYS`, `weekdayKey` | 1 |
| `repkit/js/timefmt.js` | pure: seconds ↔ min:sec | 1 |
| `repkit/js/store.js` | state + all reads/writes | 2 |
| `repkit/js/images.js` | photo → compressed Blob | 3 |
| `repkit/index.html`, `style.css`, `manifest.json`, `sw.js`, `icon.svg`, `icon-192.png`, `icon-512.png` | PWA shell | 4 |
| `repkit/js/ctx.js`, `repkit/js/app.js` | shared store, view state, tabs, render | 4 |
| `repkit/js/library.js` | Library tab | 5 |
| `repkit/js/timepick.js`, `repkit/js/plan.js` | time picker + Plan tab | 6 |
| `repkit/README.md` | run / test / deploy | 7 |
| `repkit/tests/*.test.js` | node tests | 1–3 |

---

### Task 1: Scaffold + copied modules + time formatting

**Files:**
- Create: `repkit/package.json`, `repkit/js/db.js`, `repkit/js/ui.js`, `repkit/js/dates.js`, `repkit/js/timefmt.js`
- Test: `repkit/tests/dates.test.js`, `repkit/tests/timefmt.test.js`

**Interfaces:**
- Produces:
  - `db.js`: `kv = {get, set, del, keys}`. Same as kharchly; values may be Blobs.
  - `ui.js`: `$, $$, el, icon, openModal, attachSwipe, toast, onTapOrHold`. Same as kharchly.
  - `dates.js`: everything kharchly exports, plus `WEEKDAYS = ['mon','tue','wed','thu','fri','sat','sun']` and `weekdayKey(day: 'YYYY-MM-DD') -> 'mon'..'sun'`.
  - `timefmt.js`: `formatSec(sec: number|null) -> string` (`null`→`''`, `45`→`'0:45'`, `90`→`'1:30'`, `-12`→`'−0:12'` with U+2212), `toParts(sec) -> {m, s}`, `fromParts(m, s) -> sec`.

- [ ] **Step 1: Copy** `db.js`, `ui.js`, `dates.js` from `expense-tracker/js/`. In `db.js` change the DB name to `repkit-db`. Copy kharchly's `tests/dates.test.js` alongside.
- [ ] **Step 2: Write failing tests**

```js
// tests/dates.test.js (append)
test('weekdayKey', () => {
  assert.equal(weekdayKey('2026-11-23'), 'mon');
  assert.equal(weekdayKey('2026-11-29'), 'sun');
});
// tests/timefmt.test.js
test('formatSec', () => {
  assert.equal(formatSec(null), '');
  assert.equal(formatSec(0), '0:00');
  assert.equal(formatSec(45), '0:45');
  assert.equal(formatSec(90), '1:30');
  assert.equal(formatSec(605), '10:05');
  assert.equal(formatSec(-12), '−0:12');
});
test('parts round-trip', () => {
  assert.deepEqual(toParts(125), { m: 2, s: 5 });
  assert.equal(fromParts(2, 5), 125);
});
```
- [ ] **Step 3: Implement** `weekdayKey` (use `parseDay(day).getDay()`, map Sunday=0 to `'sun'`) and `timefmt.js`.
- [ ] **Step 4: Run** `node --test` in `repkit/`. Expected: all pass (including copied kharchly date tests).
- [ ] **Step 5: Checkpoint.** Tell the user Task 1 is done. They commit.

---

### Task 2: Store

**Files:**
- Create: `repkit/js/store.js`
- Test: `repkit/tests/store.test.js`

**Interfaces:**
- Consumes: `dates.js` (`todayKey`, `WEEKDAYS`).
- Produces: `createStore(kv, { today = todayKey, makeId = uid }) -> store`, `uid()`, `SCHEMA_VERSION = 1`, `FIELDS = ['weight','reps','duration','break']`. `store` has:
  - `state = { categories, exercises, plan, planHistory, settings, meta }`
  - `boot()`: loads every key. On first run it seeds categories **Chest, Back, Legs, Shoulders, Arms, Core, Cardio** (my call; the user can rename or archive them), `plan` = 7 empty arrays, `planHistory = []`, `settings = {sound: true, countdownSec: 3}`. Throws if `meta.schemaVersion > SCHEMA_VERSION`.
  - Categories: `addCategory(name) -> cat`, `renameCategory(id, name)`, `archiveCategory(id)`, `deleteCategory(id)`. Delete throws `'Category is in use'` if any exercise references it.
  - Exercises: `addExercise({name, info, categoryIds, fields}) -> ex`, `updateExercise(id, patch)`, `archiveExercise(id)`, `deleteExercise(id)`. Delete throws `'Exercise is in use'` if it is in the plan; Plan 2 extends this check to sessions. `fields` needs at least one `true`, otherwise it throws `'Pick at least one field'`. Name is trimmed and required.
  - Images: `setExerciseImage(id, blob|null)` writes or deletes `img:<exerciseId>` and sets `imageKey`. `getImage(imageKey) -> Blob|null`.
  - Plan (`day` ∈ `WEEKDAYS`):
    - `addPlanItem(day, exerciseId) -> item`: the item starts with one empty set `{id, weight:null, reps:null, duration:null, break:null}`.
    - `removePlanItem(day, itemId)`, `movePlanItem(day, itemId, delta: -1|1)`.
    - `addSet(day, itemId) -> set`: copies the last set's values with a new id.
    - `updateSet(day, itemId, setId, patch)`, `removeSet(day, itemId, setId)`.
    - `copyDay(from, to)`: replaces `to` with a deep copy and fresh ids.
  - Every plan write runs `recordTrainingDays()`. If the list of non-empty weekdays differs from the last `planHistory` entry, it appends `{from: today(), trainingDays}`. If the last entry's `from` is already today, it replaces that entry instead. Nothing happens when unchanged.

- [ ] **Step 1: Write failing tests.** Use an in-memory `kv` (Map-backed) and a `failingKv` wrapper whose `set` rejects on demand. Tests and their key assertions:
  - `boot seeds 7 categories, empty plan, default settings`
  - `addExercise requires a name and at least one field`: throws `'Name is required'` / `'Pick at least one field'`.
  - `addPlanItem starts with one empty set; addSet copies previous values`: after `updateSet(...{weight:20, reps:12, break:60})`, `addSet` gives `{weight:20, reps:12, duration:null, break:60}` and a new id.
  - `copyDay gives fresh ids`: no item or set id is shared between `mon` and `tue`.
  - `updateExercise fields does not touch plan values`: untick `weight`, and the plan set still has `weight: 20`.
  - `archived exercise stays in plan`: `archiveExercise`, and `plan.mon[0].exerciseId` is unchanged.
  - `deleteExercise/deleteCategory refuse when in use`
  - `planHistory: first item on mon appends {from: today, trainingDays:['mon']}`
  - `planHistory: further edits same day replace, not append`: add `tue` on the same `today`, giving length 1 with `['mon','tue']`.
  - `planHistory: set edits that don't change training days add nothing`
  - `planHistory: change on a later day appends`
  - `a failed write leaves state unchanged`: make `kv.set` reject, `addExercise` rejects, `state.exercises` keeps the same length.
  - `boot refuses newer schemaVersion`
- [ ] **Step 2: Run** `node --test tests/store.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `store.js`.** Use kharchly's `store.js` as the pattern (keys object `K`, `cleanName`, write-then-mutate). Each mutation builds the new array, `await kv.set`, then assigns it to state.
- [ ] **Step 4: Run** `node --test`. Expected: all pass.
- [ ] **Step 5: Checkpoint.**

---

### Task 3: Image compression

**Files:**
- Create: `repkit/js/images.js`
- Test: `repkit/tests/images.test.js`

**Interfaces:**
- Produces:
  - `fitSize(w, h, max = 800) -> {w, h}`. Pure; keeps the aspect ratio and never upscales.
  - `compressImage(file: File) -> Promise<Blob>`. Uses `createImageBitmap(file)`, draws to a canvas at `fitSize`, then `canvas.toBlob(..., 'image/jpeg', 0.7)`. Rejects if decoding fails.

- [ ] **Step 1: Failing tests:** `fitSize(4000, 3000)` → `{w:800, h:600}`; `fitSize(3000, 4000)` → `{w:600, h:800}`; `fitSize(500, 300)` → `{w:500, h:300}`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Only `fitSize` is tested under Node. `compressImage` is checked by hand in Task 5.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Checkpoint.**

---

### Task 4: PWA shell + tabs

**Files:**
- Create: `repkit/index.html`, `style.css`, `manifest.json`, `sw.js`, `icon.svg`, `icon-192.png`, `icon-512.png`, `js/ctx.js`, `js/app.js`

**Interfaces:**
- Consumes: `store.js`, `ui.js`, `db.js`.
- Produces:
  - `ctx.js`: `store` (created from `kv`), `view = { tab: 'go', planDay: weekdayKey(todayKey()), libCat: 'all' }`, `setRender(fn)`, `rerender()`.
  - `app.js`: `render()` with tabs in order **go · plan · library · log · reports**. It keeps scroll position across renders (copy kharchly's `render()`). Swiping switches tabs.
    - `go` placeholder: today's weekday name, then that day's exercises (names + set count), or `rest day`. Small note `workout player comes in the next update`.
    - `log` and `reports` placeholders: one line each.
  - The header shows the brand `repkit` and a settings icon. Settings holds only the about line in this plan.

- [ ] **Step 1:** Copy kharchly's `index.html`, `style.css`, `manifest.json`, `sw.js` structure. Rename to repkit, set the new `--accent`, set `CACHE_NAME = 'repkit-v1'`. `ASSETS` lists **every** `js/*.js` file in this plan. The offline fallback to `index.html` is for `request.mode === 'navigate'` only. Make simple placeholder icons (a dumbbell glyph in `icon.svg`, with PNGs exported from it).
- [ ] **Step 2:** Implement `ctx.js` and `app.js`. Boot: `navigator.storage.persist?.()`, `await store.boot()`, then render. If boot fails, show the error toast.
- [ ] **Step 3: Manual check.** Ask the user to serve it (`python -m http.server 8080` in `repkit/`). Five tabs show, swipe works, reloading offline after the first load still works.
- [ ] **Step 4: Checkpoint.**

---

### Task 5: Library tab

**Files:**
- Create: `repkit/js/library.js`
- Modify: `repkit/js/app.js` (route the `library` tab), `repkit/style.css`

**Interfaces:**
- Consumes: `store` (categories, exercises, images), `compressImage`, `openModal`, `toast`, `view.libCat`.
- Produces: `renderLibrary() -> HTMLElement`, `openExerciseSheet(exerciseId|null)` (Plan 2's "add exercise" reuses it).

Behaviour (spec §6.1):
- Category chips across the top: `all`, each active category, and `+` to add one. Long-pressing a chip opens rename / archive / delete. Delete shows only if the category is unused. Archive asks with a two-tap button.
- The list shows exercises filtered by chip, sorted by name. Each row has a thumbnail (if any), the name, its category names, and field badges (`kg`, `reps`, `time`, `break`). Archived exercises are hidden behind a `show archived` toggle at the bottom.
- The `+ exercise` button and row tap both open the sheet:
  - name, required
  - info: textarea, optional
  - categories: multi-select chips, plus an inline "new category"
  - fields: four toggles, at least one; save is disabled until one is on
  - photo: pick or replace or remove via `<input type=file accept="image/*">`
  - save, and for existing exercises: archive, or delete if unused
- Photo save: `compressImage`, then `setExerciseImage`. On reject: `toast('could not read that photo', 'error')` and save the rest. Thumbnails come from `URL.createObjectURL(await store.getImage(...))`; revoke the old URLs on re-render.
- Every store call is wrapped: on error, `toast(err.message, 'error')`.

- [ ] **Step 1:** Implement `library.js` and its styles.
- [ ] **Step 2: Manual check (phone):**
  - create a category
  - create Bench Press (Chest; weight + reps + break) with a camera photo, and check the thumbnail shows
  - create Plank (Core; duration)
  - try saving with no fields: blocked
  - rename a category
  - archive an exercise: hidden, and comes back with `show archived`
  - reload: everything is kept
- [ ] **Step 3: Checkpoint.**

---

### Task 6: Time picker + Plan tab

**Files:**
- Create: `repkit/js/timepick.js`, `repkit/js/plan.js`
- Modify: `repkit/js/app.js` (route the `plan` tab), `repkit/js/app.js` Go placeholder (use real plan data), `repkit/style.css`

**Interfaces:**
- Consumes: `store` plan API (Task 2), `formatSec/toParts/fromParts`, `view.planDay`.
- Produces:
  - `openTimePicker({ title, value: sec|null, chips: number[], onPick(sec|null) })`. A bottom sheet with two scroll-snap wheel columns: minutes 0–59 and seconds 0–55 **in steps of 5** (my call: gym timings don't need 1-second precision, and it halves the wheel). Quick chips sit above the wheels, plus `clear` (sets `null`) and `done`.
  - Chip constants: `BREAK_CHIPS = [30,45,60,90,120]`, `DURATION_CHIPS = [30,45,60,90,120]`.
  - `stepper({ value, step, min = 0, unit, onChange })`: a `[−] value [+]` control. Tapping the value opens an inline numeric input. Empty means `null`. Plan 2's set screen reuses it.
  - `renderPlan() -> HTMLElement`.

Plan tab behaviour (spec §6.2):
- A Mon–Sun strip; each day shows a dot if it has exercises. Today is underlined. `view.planDay` holds the selected day.
- The day's exercise cards: name, a summary line (e.g. `3 sets · 12×20kg · break 1:00`), up/down arrows to reorder, and remove (two-tap). Tapping expands the card to its sets.
  - Each set row shows only the **ticked fields**: weight stepper (step 2.5, `kg`), reps stepper (step 1), duration and break as buttons showing `formatSec` that open `openTimePicker`.
  - Per set: remove. Under the sets: `+ set`, which copies the previous one.
  - Archived exercises are dimmed with an `archived` label, still editable and removable.
- Footer actions:
  - `+ exercise` opens a picker sheet listing active exercises, searchable, filtered by category chips.
  - `copy day to…` offers the weekday choices. If the target isn't empty, it overwrites only after a two-tap confirm.
- Empty day: `rest day` text plus `+ exercise`.
- The Go placeholder (Task 4) now reads the real plan for today.

- [ ] **Step 1:** Implement `timepick.js`. Set the wheel's start position with `scrollTop` from the value. On `scrollend` (falling back to a debounced `scroll`), read the snapped index.
- [ ] **Step 2:** Implement `plan.js` and its styles.
- [ ] **Step 3: Manual check (phone):**
  - On Monday add Bench Press, set 12 × 20 kg with a 1:00 break, then `+ set` twice: the copies match.
  - Change set 3 to 10 reps.
  - Add Plank with a 0:45 duration; it shows no kg or reps fields.
  - Reorder the two exercises.
  - Copy Monday to Thursday.
  - Untick `weight` on Bench Press in the Library: the plan hides kg. Re-tick it: 20 kg is back.
  - Archive Plank: it is dimmed in the plan.
  - Pick a 12 MP photo in the Library: no freeze.
  - Go tab on Monday lists both exercises.
  - Reload: everything is kept.
- [ ] **Step 4: Checkpoint.**

---

### Task 7: README + final pass

**Files:**
- Create: `repkit/README.md`

- [ ] **Step 1:** Write the README in kharchly's style: one-line description, `run locally` (`python -m http.server 8080`), `test` (`node --test`), `deploy` (a new Netlify site; bump `CACHE_NAME` on every release; never change the URL or `repkit-db`), and `docs`.
- [ ] **Step 2:** Check that `sw.js` `ASSETS` lists every file in `js/`, using `ls js` against the list.
- [ ] **Step 3:** Run the full `node --test`. Expected: all pass.
- [ ] **Step 4: Checkpoint.** Plan 1 is done. Next: write Plan 2 (Go).
