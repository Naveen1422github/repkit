# repkit — Design Spec

Date: 2026-11-23 · Status: awaiting review · Name: **repkit** (working name, final name decided at the end)

A phone-first PWA for planning weekly workouts and running them set by set with a big timer. Single user, single phone. Third sibling of macro (`frontend2/macro/`) and kharchly (`frontend2/expense-tracker/`), built the same way.

## 1. Intent

Naveen wants to plan his exercise week once (Mon–Sun), then at the gym just open the app, tap **Start**, and be walked through every set: big timer where a time is set, the planned weight/reps on screen, one tap per set. What he actually did gets recorded, and he decides at the end whether a change was a one-off ("today only") or should become the new plan ("update plan"). A daily log and kharchly-style reports sit on top.

## 2. Goals, non-goals, anti-goals

**Goals**
- A set done exactly as planned costs **one tap** (Done).
- A set done differently is corrected **at the moment of Done** (values pre-filled from plan, +/- steppers), so nothing has to be remembered later.
- End-of-workout screen lists **only the changes**, each with `today only | update plan`.
- Timers survive screen-lock, app switch and app kill (resume exactly where you were).
- Sound cues let you follow the workout without looking at the phone.
- Reports cover progress, volume, consistency, plan-vs-actual and time — in **two views**, never a wall of charts.

**Non-goals (v1):** kg/lb toggle (kg only), Google Drive backup (later), supersets in normal (tap-per-set) mode — alternating exercises exist only as circuits (§6.3b), body weight & measurements, built-in exercise database or videos, social/sharing, multi-device sync, accounts or a server.

**Anti-goals (failure even if it works):**
- Go screen that needs more than one tap per unchanged set, or asks "today or plan?" after every set.
- Reports that feel like a flood of numbers.
- Losing a workout in progress because the phone locked or the browser was killed.

## 3. Stack and constraints

- Vanilla JS as **native ES modules**: no framework, no build step, **zero npm dependencies** in the shipped app. `node --test` for pure modules.
- IndexedDB DB `repkit-db`: a `kv` object store (same pattern as kharchly) plus Blob values for images.
- PWA: manifest + service worker, network-first, deployed to a **new** Netlify site (own origin, own data). Bump the SW cache name on every deploy. Never change the site URL or DB name once live.
- UI language from kharchly/macro: dark theme, IBM Plex Mono for numbers, Plex Sans for text, bottom-sheet modals, inline SVG icons, hand-drawn SVG charts. Repkit gets its own accent colour (builder's call) so the three apps are told apart at a glance.
- `navigator.storage.persist()` requested on boot.
- **Reuse from kharchly** (copy, change DB name/strings): `db.js`, `ui.js`, `dates.js`, `charts.js`, SW/manifest/install-banner pattern, JSON export/import validation pattern.

## 4. File layout

```
repkit/
  index.html  style.css  manifest.json  sw.js  icon.svg  icon-192.png  icon-512.png  README.md
  docs/spec.md
  js/
    app.js        boot, tab routing (Go · Plan · Library · Log · Reports), SW, install banner
    db.js         copied from kharchly (DB name repkit-db)
    ui.js         copied from kharchly
    dates.js      copied; adds weekdayKey(date) -> 'mon'..'sun'
    store.js      state + every read/write; the ONLY module importing db.js
    library.js    Library tab: exercises + categories
    images.js     resize/compress picked photo to Blob
    plan.js       Plan tab
    timepick.js   min:sec wheel picker + quick chips
    session.js    PURE: session state machine (start, done, skip, add, reorder, finish, diff vs plan)
    timer.js      PURE: timestamp-based countdown/overtime maths
    sound.js      Web Audio tones + vibrate
    go.js         Go tab UI (drives session.js / timer.js / sound.js, wake lock)
    log.js        Log tab (calendar + day detail)
    report-data.js PURE: volume, bests, streak, consistency, plan-vs-actual
    reports.js    Reports tab (Overview + Exercise views)
    charts.js     copied from kharchly
    backup.js     JSON export / import
  tests/          node --test for session, timer, report-data, dates
```

## 5. Data model

Times are **seconds** (integers). Weight is **kg** (number, decimals allowed). Dates are local `YYYY-MM-DD` via `dates.js`, timestamps local `YYYY-MM-DDTHH:mm:ss` — never UTC-derived.

A **set value** object, used everywhere:
`{ weight?: number|null, reps?: number|null, duration?: sec|null, break?: sec|null }` — every field optional.

| Key | Shape |
|---|---|
| `categories` | `[{id, name, archived}]` — user-created, renameable |
| `exercises` | `[{id, name, info, categoryIds: string[], fields: {weight, reps, duration, break}: booleans (≥1 true), imageKey: string\|null, archived}]` |
| `img:<id>` | Blob (compressed photo) |
| `plan` | `{ mon: PlanItem[], tue: [...], ... sun: [...] }`, `PlanItem = {id, exerciseId, sets: PlanSet[]}`, `PlanSet = SetValue & {id}` — empty array = rest day |
| `planHistory` | `[{from: 'YYYY-MM-DD', trainingDays: ['mon','wed',...]}]` — appended whenever the set of non-empty weekdays changes; past calendar/streak use the entry valid on that date, so editing the plan never rewrites history |
| `sessions:YYYY-MM` | `Session[]` (see below) |
| `active` | the in-progress `Session` or `null` — written on **every** state change |
| `settings` | `{ sound: true, countdownSec: 3 \| 5 }` |
| `meta` | `{ schemaVersion: 1 }` |

```
Session = {
  id, date: 'YYYY-MM-DD', planDay: 'mon'..'sun',   // planDay can differ from date's weekday (override)
  startedAt, endedAt, status: 'done' | 'partial',
  items: [{
    exerciseId, planItemId: string|null,            // null = extra exercise added mid-workout
    sets: [{ planSetId: string|null,                // which PlanSet this came from; null = extra set
             planned: SetValue|null,                // snapshot of the plan at start; null = extra set
             actual: SetValue,                      // duration/break filled from the timer
             status: 'done' | 'skipped' | 'pending' }]
  }]
}
```

`active` additionally carries a runtime cursor, stripped when the session is saved:
`run: { itemIdx, setIdx, phase: 'set' | 'break', timerStartedAt: ts|null, extraSec }` (`extraSec` = +15s taps).

Rules:
- A session **snapshots the plan at Start**. Editing the plan while a workout is active does not affect it. `date` = the start date, even if the workout crosses midnight.
- "Update plan" works **per set by `planSetId`** (never by position): changed set → overwrite that PlanSet's values; extra set → append to that PlanItem; extra exercise → append a new PlanItem. The plan never loses sets through Go; removing sets is done in the Plan tab.
- Exercises and categories are **archived, never hard-deleted** once used in a plan or session (history must still render). Unused ones may be deleted.
- An exercise with several categories counts **fully in each** category in reports.
- If an exercise's `fields` change later, untick hides the field everywhere but keeps stored values.

## 6. Screens

### 6.1 Library
- List of exercises grouped/filterable by category chips. Add/edit sheet: name, info (optional), categories (multi-select, create new inline), fields to track (tick any of weight / reps / duration / break, at least one), photo (optional).
- Photo: picked from camera/gallery, resized on a canvas to max 800px long edge, JPEG ~0.7 → stored as Blob (~100KB).
- Categories manageable from the Library (create, rename, archive).

### 6.2 Plan
- Weekday strip Mon–Sun; selecting a day shows its exercises. "Add exercise" picks from Library.
- Each exercise expands to its sets. Only ticked fields are shown; every field is optional.
- **Add set copies the previous set** (so rest/weight are entered once) — builder's convenience, my call.
- Duration and break use `timepick.js`: phone-style min:sec wheel (scroll-snap) + quick chips (30s, 45s, 60s, 90s, 2m).
- Weight and reps: numeric fields with +/- steppers (weight step 2.5, reps step 1; tap to type any value).
- Reorder exercises within a day; copy a whole day to another day; remove exercise/set.

### 6.3 Go (home tab)
**Before start:** opens on today's weekday plan — list of exercises with a one-line set summary and a big **Start**. Rest day (empty plan) shows "Rest day" + "Do a workout anyway". Always available: **"Do a different day"** → pick Mon–Sun (the override; `session.planDay` records which plan was used).

**Running:** goes exercise by exercise, set by set (A A A, then B B B).
- **Set screen:** exercise name, `Set 2 / 4`, the planned values for ticked fields shown as +/- steppers **pre-filled with the plan**, and a big **Done**.
  - If the set has a `duration`: big clock in the middle. Starts on a **Start set** tap, counts down, at 0 keeps counting into **negative/red overtime** (`−00:12`) until Done. `actual.duration` = elapsed seconds.
  - No duration: no clock, just values + Done.
- **Break screen** (after Done, if the set has a break): big countdown, "next: <exercise> set N", **Skip** and **+15s**. Overtime counts on the same way until the next set is started. `actual.break` = elapsed (also when skipped). The break after an exercise's last set **is** shown (rest before the next exercise); the break after the last set of the whole workout is not. A skipped set skips its break. If `break` is unticked on the exercise, no break screen, even if a value is stored.
- Always available from a menu: **skip set**, **skip exercise**, **add set** (copies last), **add exercise** (from Library), **reorder remaining**, **quit**.
- **Quit early:** "save as partial" or "discard".
- **Resume:** if `active` exists on boot, Go opens straight into it at the same set, timers recomputed from stored timestamps.

**Finish screen:** total time, then **only the differences** from plan:
- a set whose `actual` ≠ `planned` on any ticked field (`12×20 → 15×25`),
- extra sets, extra exercises.

Each row has a `today only | update plan` toggle, default **today only**. Save writes the session; rows set to "update plan" write the actual values (or the extra set/exercise) into `plan[session.planDay]`. Skipped sets are logged but never offered as plan changes. A session with any skipped set or early quit is `partial`.

### 6.3b Circuits (added 2026-11-24)

**Why:** some workouts are interval style: "20 s push-ups, 30 s break, × 5" or "push-ups → plank → mountain climbers, each 20 s with 10 s break, × 3 rounds". Tapping start/done every 20 s breaks the flow. A circuit runs **hands-free**.

**Plan.** A weekday holds a list of **entries**: a normal exercise (as before) or a **circuit**:
`Circuit = {id, type: 'circuit', rounds: int ≥ 1, items: PlanItem[]}` — each circuit `PlanItem` has **exactly one set**, the template used every round (work duration, reps/kg, break). A one-exercise circuit is fine (20 s × 5).
Plan tab: `+ circuit` creates one (rounds 3); inside it `+ exercise`, a rounds stepper, per-exercise set row (same fields UI as normal sets), remove. Entries reorder up/down at day level; exercises reorder inside their circuit. Copy day copies circuits with fresh ids. A day counts as a training day for `planHistory` when it holds at least one exercise (inside a circuit or not); a day with only an empty circuit does not.

**Session.** At Start a circuit expands into one session item per exercise, each with `rounds` sets (copies of the template, `planSetId` = template id, `round` = 1..n) and a shared `circuitId`. **Execution order** is derived, never stored: normal items run set by set; a circuit block runs round-robin (A1 B1 C1, A2 B2 C2, …). The cursor is the first pending set in that order.

**Go — hands-free flow inside a circuit:**
- A timed set **starts by itself** when it becomes current and **ends by itself at 0** (low beep) — no overtime in circuits. Reps/kg are logged as planned unless changed.
- Then its break starts by itself (high ticks/beep at the end), then the next set starts by itself. The break after the very last set of the workout is not shown (same rule as §6.3). The last exercise's break is the rest between rounds.
- A circuit exercise **without a duration** (reps only) is the one stop: it waits for **Done**, then flow continues.
- **Fix reps during the break:** the break screen shows `just now: <exercise>` with +/- steppers for the set that just ended (pre-filled). Changing them never pauses anything.
- **Pause / resume** button on circuit screens; pausing freezes the clock exactly, resume continues.
- If the screen was hidden (app switched) the flow **catches up** on return: every step whose time passed is completed with its exact timestamps, and the current step's clock is correct. No beeps are replayed.
- After an **app kill**, a circuit resumes **paused** at the step it was on (the user taps resume) — it never auto-completes minutes of work nobody saw.
- Menu inside a circuit: skip this set, skip this exercise (all its remaining rounds), quit. "Add set" and "reorder" are not offered for circuit items (v1).
- Normal exercises are unchanged (tap start set, overtime, tap done).

**Finish screen for circuits:** one row per circuit exercise whose done rounds differ from the template, showing all rounds (`push-ups · reps 15 → 17, 15, 14`). "Update plan" sets the template to the value reached in **every** done round (the lowest) — the plan stays something you can do each round. Duration and break are never offered (they are the clock).

### 6.4 Log
- Month calendar: ● done, ○ partial, ✕ missed planned day, · rest day (no plan). Streak count at top.
- Tap a day → sessions that day: plan day name, duration, exercises with each set's actual values (skipped shown dimmed).
- Editing/deleting a past session: allowed (fix a typo) — builder's call on UI, my call to include.

### 6.5 Reports — two views, `week | month` toggle
**Overview**
- Three tiles: days done / planned days, total time, current streak.
- Volume by category: horizontal bars (kharchly chart), vs previous period ▲/▼ %. Tap a category → its exercises.

**Exercise** (pick one)
- Best-set line over time (sparkline/line chart).
- Plan vs actual counts: above / equal / below.
- Hint "You've beaten plan N times. Raise it?" — shown only when the **last 3** sessions of that exercise were all "above".

Definitions (in `report-data.js`):
- **Volume** = Σ weight × reps over done sets having both. Exercises without both don't contribute.
- **Best set**: weight exercises → max weight (tie → more reps); reps-only → max reps; duration-only → max duration.
- **Above/equal/below** per set: above = every planned ticked value met and at least one exceeded; below = any value lower; else equal. Per session the exercise's majority decides.
- **Streak** = consecutive planned days with a session (done or partial). Rest days don't break it; a missed planned day does. A workout on a rest day (override) counts as a done day.
- **Consistency** = planned days with a session ÷ planned days in range, counting only from the first-ever session date.

## 7. Timers, sound, screen

- **Timestamp-based:** a running timer stores `startedAt`; displayed time = `now − startedAt` (or `target − elapsed`). Rendering ticks via `requestAnimationFrame`/`setInterval`, but the truth is the timestamp — background/lock never drifts it.
- **Wake lock:** `navigator.wakeLock.request('screen')` while a session is active; re-requested on `visibilitychange`. Released on finish/quit.
- **Sound** (Web Audio oscillator, no files; the Start tap unlocks audio):

| Moment | Sound |
|---|---|
| Exercise timer, last 3 s (or 5, setting) | short **low** tick each second |
| Exercise timer reaches 0 | long **low** beep + vibrate ("stop") |
| Overtime (exercise or break) | soft double beep every 30 s |
| Break, last 3 s (or 5) | short **high** tick each second |
| Break reaches 0 | long **high** beep + vibrate ("go") |

  Low ≈ 440 Hz, high ≈ 880 Hz (builder may tune). 🔊/🔇 toggle on the Go screen; countdown length 3/5 in settings. Beeps missed while the screen was locked are not replayed. Vibration is Android-only (iOS ignores it).

## 8. Backup
- Settings → **Export** downloads `repkit-backup-YYYY-MM-DD.json` (all keys; images as data URLs). **Import** validates schema then replaces all data after a confirm; `active` is cleared; a backup with a higher `schemaVersion` than the app is refused. Images go in the same file as data URLs (no size limit; a few dozen photos ≈ a few MB, acceptable). Google Drive backup is a later phase (reuse kharchly `drive.js`).

## 9. Approaches considered

1. **Kharchly-style modular vanilla JS** — *chosen.* Proven stack, reuses charts/db/ui/dates, pure modules testable; the Go state machine gets its own tested module.
2. Macro-style single `app.js` — fastest start, but the Go screen's timer/resume/diff logic would make one file unsafe to change.
3. Svelte/Preact with a build — nicer reactive timer UI, but breaks the zero-dependency family, adds a build, can't reuse kharchly code directly.

## 10. Left to the builder
Check kharchly's `charts.js` has horizontal bars + a line chart; add the line chart if missing. Accent colour and exact visual polish; drag vs up/down buttons for reordering; chart details; exact tone frequencies/lengths; empty states and first-run copy (keep it short, no invented marketing text); build order (suggested: Library → Plan → Go → Log → Reports → Export).
