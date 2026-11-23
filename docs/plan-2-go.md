# repkit — Plan 2: Go (workout player)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Go tab runs a workout end to end. It covers:
- start today's plan, or another day's (override)
- set screen: values pre-filled from the plan, one-tap Done, a big timer with red overtime
- break screen with skip and +15s
- sound cues, screen kept awake, resume after app kill
- finish screen listing only the changes, each with `today only | update plan`
- quit as partial or discard

**Architecture:**
- All workout logic lives in two **pure** modules, so Node can test it:
  - `session.js`: a state machine over a plain Session object; every function returns a new object.
  - `timer.js`: maths from timestamps, plus which sound cues to fire.
- `go.js` is a thin UI that calls them and persists each new state through `store.saveActive`.
- The truth is always the stored Session plus `Date.now()`. Nothing depends on a JS interval surviving.

**Tech Stack:** vanilla ES modules, IndexedDB via `store.js`, Web Audio API, Screen Wake Lock API, Vibration API, `node --test`.

**Spec:** `repkit/docs/spec.md` §5 (Session, `active`, rules), §6.3, §7. Builds on Plan 1 (`docs/plan-1-foundation-library-plan.md`). The ledger is `repkit/.superpowers/progress.md`: read its Plan 1 rulings, especially "store writes are serialized".

## Global Constraints

- Everything in Plan 1's Global Constraints still applies: zero deps, `repkit-db`, seconds and kg, dates via `dates.js`, store is the only kv user, validate → write → state, no `alert`/`confirm`, kharchly UI language, **no builds, no git writes**, tests through a background subagent.
- Session timestamps (`startedAt`, `endedAt`) are local `YYYY-MM-DDTHH:mm:ss` from the new `nowTsSec()`. The runtime timer start `run.timerStartedAt` is **epoch ms** (`Date.now()`), so elapsed time survives lock and kill.
- `session.date` is the **start** date, even if the workout crosses midnight.
- A session **snapshots the plan at Start**. Editing the Plan tab during a workout doesn't change it.
- Sound: low ≈ 440 Hz means stop (exercise timer), high ≈ 880 Hz means go (break). Countdown ticks in the last `settings.countdownSec` (3 or 5). Overtime: a soft double beep every 30 s. Beeps missed while the screen was locked are **not replayed**.
- **Ruling carried into this plan: what counts as a "change" on the finish screen.**
  - weight and reps: exact compare
  - duration: the measured value rounded to the nearest 5 s, compared with the planned value
  - break: **never** offered as a plan change. A measured break is mostly noise (skip, +15s, phone in hand). It is still logged in `actual.break`.

  Otherwise every timed set would show up as "changed" by a second or two. Cost if wrong: the user can't promote a longer break from Go; they edit it in the Plan tab instead.

## Review Focus

1. **App killed mid-break, reopened 4 minutes later.** It resumes on the same break with the clock deep in red overtime, computed from the stored `timerStartedAt`. No reset, no crash. Pinned by Task 2 test `active round-trips through boot` and Task 1 test `remainingSec goes negative`.
2. **Screen unlocked after a long gap.** Exactly zero beeps fire for the skipped seconds, not a burst. Pinned by Task 1 test `cuesBetween ignores big jumps`.
3. **Double-tap on Done**, or Done tapped during a break: no second set gets completed. Pinned by Task 1 test `completeSet is a no-op outside phase set`.
4. **Plan changed or deleted during an active workout**, then "update plan" is chosen. A row whose `planSetId` or `planItemId` no longer exists is skipped. No crash, and the rest still apply. Pinned by Task 1 test `applyDiff skips rows whose plan targets are gone`.
5. **Timed sets: measured times differ from plan by a second or two.** These are not listed as changes; the 5 s rounding applies, and breaks are never listed. Pinned by Task 1 test `diffFromPlan ignores timer noise and breaks`.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `js/timer.js` | pure: elapsed / remaining / which cues to fire | 1 |
| `js/session.js` | pure: Session state machine, diff vs plan, apply diff to plan | 1 |
| `js/dates.js` | + `nowTsSec()` | 1 |
| `js/store.js` | + `active`, `saveActive`, `completeWorkout`, history-aware `deleteExercise` | 2 |
| `js/sound.js` | Web Audio tones + vibrate | 3 |
| `js/go.js` | Go tab UI: pre-start, set, break, menu, finish, quit | 4 |
| `js/app.js` | route Go, resume on boot, settings (sound, countdown) | 4 |
| `style.css`, `sw.js` | Go styles; add the new modules to `ASSETS`, `CACHE_NAME` → `repkit-v2` | 4 |
| `tests/timer.test.js`, `tests/session.test.js`, `tests/store.test.js` | node tests | 1–2 |

---

### Task 1: Timer maths + session state machine (pure)

**Files:**
- Create: `js/timer.js`, `js/session.js`
- Modify: `js/dates.js` (add `nowTsSec`)
- Test: `tests/timer.test.js`, `tests/session.test.js`

**Interfaces:**
- Consumes: `dates.js` `nowTsSec`. Plan 1's PlanItem/PlanSet shapes and `FIELDS` from `store.js`. Only the constant is imported; `session.js` must not import anything that touches kv.
- Produces, in `timer.js`:
  - `elapsedSec(startMs, nowMs) -> int` (floor, never < 0)
  - `remainingSec(targetSec, startMs, nowMs, extraSec = 0) -> int` (`target + extra − elapsed`, may be negative)
  - `cuesBetween(prevRem, rem, countdownSec) -> Array<'tick'|'end'|'over'>`. For each integer `k` with `rem <= k < prevRem` (newest last):
    - `1 ≤ k ≤ countdownSec` gives `'tick'`
    - `k === 0` gives `'end'`
    - `k < 0 && k % 30 === 0` gives `'over'`

    If `prevRem − rem > 2` it returns `[]`: a big jump means we were asleep, so nothing is replayed.
- Produces, in `session.js`. Every function is pure and returns a **new** Session. `fieldsOf(exerciseId) -> {weight,reps,duration,break}` is passed in wherever ticked fields matter. Shapes are from spec §5, plus `run = {itemIdx, setIdx, phase: 'set'|'break'|'finished', timerStartedAt: ms|null, extraSec}`.
  - `startSession({ planItems, planDay, date, startedAt }) -> Session`
    - Snapshot: each set becomes `{planSetId, planned: {weight,reps,duration,break}, actual: {...same}, status: 'pending'}`.
    - The cursor goes to the first pending set, `phase: 'set'`.
    - With zero items the result has `run.phase === 'finished'`.
  - `currentSet(s) -> {item, set, itemIdx, setIdx} | null`
  - `startSetTimer(s, nowMs)` sets `run.timerStartedAt`. It is a no-op if already started or `phase !== 'set'`.
  - `completeSet(s, actualPatch, nowMs, fieldsOf)` is a **no-op unless `phase === 'set'`**. It:
    - merges `actualPatch` into the current set's `actual` and marks it `done`
    - if `fields.duration` and the timer was started, sets `actual.duration = elapsedSec`
    - then, if `fields.break` and `actual.break != null` and at least one pending set remains, goes to `phase: 'break'` with `timerStartedAt = nowMs`, `extraSec = 0`, and the cursor still on the done set
    - otherwise advances
  - `addBreakTime(s, sec)` adds to `extraSec`, during a break only.
  - `endBreak(s, nowMs)` stores `actual.break = elapsedSec` on the cursor set, then advances. It is a no-op unless `phase === 'break'`.
  - `skipSet(s)` marks the current set `skipped` with no break, then advances. `skipExercise(s)` marks every pending set of the current item `skipped`, then advances.
  - Advancing puts the cursor on the **first pending set in item order**: `phase: 'set'`, `timerStartedAt: null`. If there is none, `phase: 'finished'`.
  - `addSetToCurrent(s)` appends `{planSetId: null, planned: null, actual: copy of the last set's actual (duration reset to planned value or null), status: 'pending'}` to the current item.
  - `addExercise(s, exerciseId)` appends `{exerciseId, planItemId: null, sets: [one set with all-null actual, planned null, planSetId null, pending]}`.
  - `moveRemaining(s, itemIdx, delta)` swaps two items only if **both have no done or skipped sets**. Otherwise it is a no-op.
  - `finish(s, endedAt, { quit = false })`: when quitting, pending sets become `skipped`. `status` is `'partial'` if any set is skipped, else `'done'`. It sets `endedAt` and **removes `run`**.
  - `diffFromPlan(s, fieldsOf) -> rows[]`, where each row is one of:
    - `{key, kind: 'changed', exerciseId, planItemId, planSetId, from: SetValue, to: SetValue}` for a done set with a `planSetId` whose weight/reps differ exactly, or whose duration differs after rounding the actual to 5 s. Only ticked fields count.
    - `{key, kind: 'extraSet', exerciseId, planItemId, to}` for a done set with `planned === null` inside an item that has a `planItemId`
    - `{key, kind: 'extraExercise', exerciseId, sets: SetValue[]}` for an item with `planItemId === null` and at least one done set

    `key` is a stable string such as `` `${itemIdx}:${setIdx}` `` or `` `x${itemIdx}` ``. Skipped sets never produce rows.
  - `applyDiff(planDayItems, rows, makeId) -> newPlanDayItems`:
    - `changed` overwrites weight, reps and duration (not break) on the PlanSet with id `planSetId`
    - `extraSet` appends `{id: makeId(), ...to}` to that PlanItem
    - `extraExercise` appends a new PlanItem with fresh ids
    - rows whose target id is missing are skipped
- `dates.js`: `nowTsSec() -> 'YYYY-MM-DDTHH:mm:ss'` (local).

- [ ] **Step 1: Write failing tests.** `tests/timer.test.js`:
  - `elapsedSec floors and clamps`: `(1000, 3999)` gives 2, `(5000, 1000)` gives 0
  - `remainingSec goes negative`: `remainingSec(60, 0, 75000)` gives −15, `remainingSec(60, 0, 75000, 15)` gives 0
  - `cuesBetween countdown 3`: `(4, 3, 3)` gives `['tick']`, `(1, 0, 3)` gives `['end']`, `(4, 4, 3)` gives `[]`, `(6, 5, 3)` gives `[]`
  - `cuesBetween overtime every 30s`: `(-29, -30, 3)` gives `['over']`, `(-30, -31, 3)` gives `[]`
  - `cuesBetween ignores big jumps`: `(50, -200, 3)` gives `[]`
  - `cuesBetween two-step catch-up still fires`: `(2, 0, 3)` gives `['tick','end']`

  `tests/session.test.js` uses a fixture: a bench item with 2 sets `{weight:20, reps:12, break:60}` and fields weight/reps/break; a plank item with 1 set `{duration:60}` and field duration only.
  - `startSession snapshots plan and pre-fills actual`: 3 pending sets, `actual` deep-equals `planned`, cursor 0:0, phase set
  - `startSession with no items is finished`
  - `completeSet with break goes to break, then endBreak records break and advances`: complete at t=0, endBreak at t=75000. Gives `actual.break === 75`, cursor 0:1, phase set.
  - `completeSet merges patch`: patch `{reps: 15, weight: 25}` gives `actual` `{weight:25, reps:15, …}`, status done
  - `completeSet is a no-op outside phase set`: calling it during a break returns the same values, with no extra done set
  - `last set before a timed exercise still gets its break; final set of workout gets none`
  - `timed set measures duration`: `startSetTimer` at 0, `completeSet` at 72400. Gives `actual.duration === 72`, phase finished.
  - `skipSet skips its break; skipExercise skips remaining sets of item`
  - `addSetToCurrent copies actual with planned null; addExercise appends planItemId null`
  - `moveRemaining refuses items with done sets`
  - `finish quit marks pending skipped and partial; removes run`
  - `finish all done is done`
  - `diffFromPlan lists changed weight/reps only for ticked fields`
  - `diffFromPlan ignores timer noise and breaks`: duration 62 vs 60 gives no row, 75 vs 60 gives a row (to 75), break 90 vs 60 gives no row
  - `diffFromPlan lists extra set and extra exercise; skipped never`
  - `applyDiff overwrites by planSetId, appends extras, keeps break`
  - `applyDiff skips rows whose plan targets are gone`
- [ ] **Step 2: Run** `node --test tests/timer.test.js tests/session.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `nowTsSec`, `timer.js` and `session.js` to the signatures above. Use `structuredClone` for the new-object rule.
- [ ] **Step 4: Run** `node --test`. Expected: all pass, Plan 1's 31 included.
- [ ] **Step 5: Checkpoint.** The ledger line goes in. The user commits.

---

### Task 2: Store — active workout + completed sessions

**Files:**
- Modify: `js/store.js`
- Test: `tests/store.test.js` (append)

**Interfaces:**
- Consumes: `session.js` (`applyDiff`), `dates.js` (`monthKey`).
- Produces:
  - `state.active: Session | null`, loaded in `boot()` from key `active`.
  - `saveActive(session | null)` (serialized): writes `active`, or deletes it when `null`.
  - `completeWorkout(finishedSession, rowsToApply)` (serialized). Order:
    1. append the session to `sessions:<monthKey(session.date)>`
    2. if `rowsToApply.length`, apply `applyDiff(plan[session.planDay], rows, makeId)` through the existing plan-save path, which also updates `planHistory`
    3. delete `active`

    If step 1 fails nothing changes and it throws. If step 2 fails the session is still saved and the error is rethrown, so the UI says "workout saved, plan not updated".
  - `loadSessions(monthKey) -> Session[]` (read-only; Plan 3's Log uses it too).
  - `deleteExercise` now also refuses (`'Exercise is in use'`) when the exercise appears in `active` or in any `sessions:*` key. It scans `kv.keys('sessions:')`.

- [ ] **Step 1: Write failing tests**:
  - `active round-trips through boot`: `saveActive(s)`, a new store, `boot`, then `state.active` deep-equals `s`, including `run.timerStartedAt`
  - `saveActive(null) clears`
  - `completeWorkout writes month, applies rows to planDay, clears active`: check `loadSessions('2026-11')` length 1, the plan set weight updated, `state.active === null`
  - `completeWorkout with failing session write changes nothing`
  - `deleteExercise refuses when used in a past session or the active one`
- [ ] **Step 2: Run** `node --test tests/store.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Reuse the private `savePlan` for step 2. Add the new writes to the `serial` map.
- [ ] **Step 4: Run** `node --test`. Expected: all pass.
- [ ] **Step 5: Checkpoint.**

---

### Task 3: Sound

**Files:**
- Create: `js/sound.js`

**Interfaces:**
- Produces: `createSound() -> { unlock(), play(cue: 'tick'|'end'|'over', tone: 'low'|'high'), setEnabled(bool) }`.
  - `unlock()` creates or resumes the `AudioContext`. It must be called from the Start tap or a resume tap (a user gesture).
  - `tick` is a 70 ms sine. `end` is a 600 ms sine and calls `navigator.vibrate?.(300)`. `over` is two 90 ms beeps 150 ms apart, at half gain.
  - `low` is 440 Hz, `high` is 880 Hz. Each tone has a short gain envelope (5 ms attack, 40 ms release) so it doesn't click.
  - When disabled, `play` does nothing, vibrate included.
  - Any error, such as no AudioContext, is swallowed: sound must never break the workout.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Manual check:** a temporary button in the browser console path plays each cue at both tones and sounds different. Remove the temporary code.
- [ ] **Step 3: Checkpoint.**

---

### Task 4: Go tab UI + resume + settings

**Files:**
- Create: `js/go.js`
- Modify: `js/app.js` (route `go` to `renderGo`, remove the placeholder; boot opens Go when `store.state.active` exists; settings sheet gains a `sound on/off` toggle and `countdown 3 s | 5 s`), `style.css`, `sw.js` (add `timer.js`, `session.js`, `sound.js`, `go.js` to `ASSETS`, `CACHE_NAME = 'repkit-v2'`)

**Interfaces:**
- Consumes: `session.js`, `timer.js`, `createSound`, `store.saveActive/completeWorkout/updateSettings`, `stepper` and `openTimePicker` from `timepick.js`, `setSummary` and `dayName` from `plan.js`, `openExercisePicker`-style list (build a local picker; don't import plan.js internals), `formatSec`, `nowTsSec`, `todayKey`, `weekdayKey`.
- Produces: `renderGo() -> HTMLElement` and `goTeardown()`. `app.js` calls `goTeardown()` before re-rendering away from Go; it stops the tick loop and releases the wake lock.

Screens. Each one renders from `store.state.active` plus `Date.now()`.

- **No active workout (pre-start):**
  - Header `today · monday`, or the override day's name.
  - The day's exercises, one row each: name plus `setSummary` of the first set and the set count.
  - A big **start** button.
  - Empty day: `rest day` plus a **do a workout anyway** button that opens the day picker.
  - Always shown: a **do a different day** link that opens a sheet with Mon–Sun chips. Picking one sets a local `view.goDay` (default today) and re-renders.
  - Start does `sound.unlock()`, then `startSession({ planItems: store.state.plan[day], planDay: day, date: todayKey(), startedAt: nowTsSec() })`, then `saveActive`, then wake lock and render.
- **Set screen (`phase: 'set'`):**
  - Exercise name, `set 2 / 4`, the photo thumbnail if any, and the info text collapsed.
  - Steppers for the ticked `weight` and `reps`, pre-filled from `actual`. Their changes are held locally until Done.
  - If `duration` is ticked: a big clock (`.rk-clock`).
    - Before the timer starts it shows the planned value and a **start set** button.
    - Once running it shows `remainingSec`, red (`.over`) and prefixed `−` when below 0. If the planned duration is null, it counts **up** from 0 instead.
  - A big **done** button. A menu button (⋯, using the `layers` icon) opens the sheet below.
- **Break screen (`phase: 'break'`):**
  - A big clock: `remainingSec(actual.break, timerStartedAt, now, extraSec)`, with overtime shown the same way.
  - `next: <exercise> · set N`.
  - **skip** (calls `endBreak`) and **+15s** (calls `addBreakTime(15)`).
  - Overtime doesn't advance the cursor; the user taps skip, or **start next** (the same as skip, relabelled once the clock is below 0).
- **Menu sheet:**
  - skip set, skip exercise, add set, add exercise (local picker over active exercises)
  - reorder remaining: a list of not-started items with up/down
  - quit, which offers **save as partial** (`finish(quit:true)` and on to the finish screen) or **discard** (two-tap, then `saveActive(null)`)
- **Finish screen (`phase: 'finished'`, or after quit):**
  - Total time (`endedAt − startedAt`, as m:ss).
  - `diffFromPlan` rows, each formatted like `bench press · set 2   12×20kg → 15×25kg`, with a two-option toggle `today only | update plan`, default today only.
  - With no rows: `matched the plan`.
  - **save** calls `completeWorkout(finished, chosenRows)`, then a toast `workout saved`, then the pre-start screen. If the plan update failed: toast `workout saved, plan not updated`.
  - The finished-but-unsaved session is kept in `active`, so a kill on this screen resumes here.
- **Tick loop:**
  - While a clock is visible, a 250 ms `setInterval` updates **only the clock text and class**, without a full re-render.
  - It computes `rem`, calls `cuesBetween(prevRem, rem, settings.countdownSec)`, and plays each cue: low tone on the set screen, high on the break screen.
  - Cleared on every re-render and on `goTeardown`.
- **Wake lock:** `navigator.wakeLock?.request('screen')` while `active` exists, re-requested on `visibilitychange` back to visible, released on finish or discard. Failure is silent.
- **Sound toggle:** a 🔊 / 🔇 icon button on running screens that flips `settings.sound` through `updateSettings` and `sound.setEnabled`. Add `volume` and `volumeOff` SVG paths to `ui.js` `icon`, no emoji.
- Every state change is `next = fn(...)`, then `await store.saveActive(next)`, then re-render. On a failed save: toast the error, re-render from the stored state.
- **Resume:** boot with `state.active` sets `view.tab = 'go'`. The first render shows the current screen with clocks computed from `timerStartedAt`. A small `tap to resume sound` banner shows until a tap calls `sound.unlock()`, since browsers block audio until a gesture.

- [ ] **Step 1:** Implement `go.js`, the `app.js` changes, styles and the `sw.js` changes.
  - Big clock: Plex Mono, about 72px.
  - Done button: full width, about 64px tall.
  - Overtime colour: `var(--danger)`.
- [ ] **Step 2: Manual check (phone, served over the LAN or deployed):**
  - Run Monday's plan.
  - Done on set 1 with reps changed to 15. The break counts down with high ticks at 3-2-1 and a long high beep at 0, then goes red. +15s works.
  - Plank: start set, low ticks, low beep at 0, the red overtime count, a double beep at −0:30, done.
  - Mid-break, lock the screen for 1 minute then unlock: the clock is correct and no burst of beeps.
  - Mid-break, kill the browser and reopen: it resumes on the break with the correct clock.
  - Finish screen lists the bench set 2 change and the plank change only if it was ≥ 5 s off. Choose update plan on bench, then save. The Plan tab shows 15 reps.
  - Do a different day (Thursday) on a Monday. Quit then discard leaves nothing saved.
  - Sound toggle mutes. Countdown 5 s in settings gives 5 ticks.
- [ ] **Step 3: Run** `node --test`. Expected: all pass. Check `sw.js` `ASSETS` against `ls js`.
- [ ] **Step 4: Checkpoint.** Plan 2 is done. Next: Plan 3 (Log + Reports + Export).
