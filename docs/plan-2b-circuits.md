# repkit — Plan 2b: Circuits (hands-free intervals)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekday can hold **circuit** blocks: one or more exercises, each with one set template, run for N rounds. In Go they run hands-free:
- work auto-starts and auto-ends at 0, then the break auto-starts, then the next exercise auto-starts
- reps can be fixed during the following break
- pause/resume
- catch-up after the app was in the background
- a paused resume after an app kill

Normal exercises are unchanged.

**Architecture:**
- A new pure module `planshape.js` lets every plan reader treat a day as **entries** (exercise or circuit) through four helpers.
- `session.js` gains the circuit expansion and the derived round-robin execution order. Its new pure `tickCircuit(s, nowMs, fieldsOf)` performs every auto-step from timestamps, so catch-up and live ticking are the same code.
- `go.js` calls `tickCircuit` on its tick loop and persists only when the state changed.

**Tech Stack:** as Plan 2.

**Spec:** `repkit/docs/spec.md` §6.3b (the authority), plus §5 and §6.3. Builds on Plans 1 and 2. Read both ledgers' `Ruling:` lines: `.superpowers/progress.md` and `.superpowers/progress-plan-2.md`.

## Global Constraints

- Everything in Plan 1 and 2's Global Constraints still applies.
- **Old data keeps working.** A day entry with no `type` is an exercise `PlanItem`. Plans saved before this change load and run unchanged. No migration.
- Circuit shape: `{id, type: 'circuit', rounds: int ≥ 1, items: PlanItem[]}`. Every circuit `PlanItem` has **exactly one set**. Default `rounds` is **3**.
- Session circuit items carry `circuitId`. Their sets carry `round` (1-based). `planSetId` is the template set's id for every round.
- Execution order is **derived, never stored**:
  - normal items run set by set
  - a run of consecutive items sharing a `circuitId` goes round-robin by set index
- Circuit steps start their timer when they become current: `run.timerStartedAt = nowMs`.
- A circuit set with a duration ends **exactly** at its target (`actual.duration = target`). There is no overtime. Its break ends exactly at `break + extraSec`.
- `run.pausedAt: ms | null` (default `null`). While paused, every clock uses `pausedAt` as "now". Resume shifts `timerStartedAt` forward by the paused time.
- After an app kill, the circuit step resumes paused with a **fresh full step**. A background catch-up replays no beeps (Plan 2's `cuesBetween` jump rule already guarantees that).
- Circuit finish row: kind `'circuit'`, shown when any done round differs from the template on ticked **weight/reps**. "Update plan" writes the **lowest** done-round value for each ticked weight/reps field. Duration and break are never written from a circuit.
- In Go, circuit items get no "add a set", no "reorder", no overtime. Skip set, skip exercise (all its remaining rounds) and quit work.

## Review Focus

1. **Phone in the pocket with the screen on but the app switched away for 50 s mid-circuit.** On return the steps whose time passed are done with exact timestamps, the current clock is correct, and there is no burst of beeps. Pinned by Task 2 test `tickCircuit catches up several steps with exact timestamps`.
2. **App killed mid-circuit and reopened.** It is paused on the same step with the full step time. Nothing was auto-completed. Pinned by Task 2 test `restartStepPaused`.
3. **Pause during a break, wait, resume.** The remaining time is unchanged. Pinned by Task 2 test `pause/resume freezes the clock`.
4. **A plan saved before circuits existed** (entries without `type`) still boots, renders and starts a session. Pinned by Task 1 test `legacy entries are exercises` and Task 2 test `startSession with mixed entries`.
5. **A reps-only exercise inside a circuit** never auto-advances; it waits for Done, then the flow continues. Pinned by Task 2 test `tickCircuit waits on reps-only step`.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `js/planshape.js` | pure: `isCircuit`, `flatItems`, `findItem`, `mapItems` over a day's entries | 1 |
| `js/store.js` | circuit plan ops; nested lookups in existing ops; nested `isInPlan` | 1 |
| `js/session.js` | expand circuits, execution order, auto timers, `tickCircuit`, pause/resume, `restartStepPaused`, `editDoneSet`, circuit diff/apply | 2 |
| `js/plan.js` | circuit card UI | 3 |
| `js/go.js`, `js/app.js` | hands-free screens, pause, fix reps during break, catch-up in tick loop, paused resume on boot, circuit finish rows | 4 |
| `style.css`, `sw.js` | circuit styles; `planshape.js` in `ASSETS`; `CACHE_NAME = 'repkit-v3'` | 3–4 |
| `tests/planshape.test.js`, `tests/store.test.js`, `tests/session.test.js` | node tests | 1–2 |

---

### Task 1: Plan shape + store circuit ops

**Files:**
- Create: `js/planshape.js`
- Modify: `js/store.js`
- Test: `tests/planshape.test.js`, `tests/store.test.js` (append)

**Interfaces:**
- Produces, in `planshape.js` (pure):
  - `isCircuit(entry) -> boolean`: `entry.type === 'circuit'`
  - `flatItems(entries) -> PlanItem[]`: day order, circuits expanded in place
  - `findItem(entries, itemId) -> { item, circuit: Circuit|null } | null`
  - `mapItems(entries, itemId, fn) -> entries`: replaces the matching item (top level or inside a circuit) with `fn(item)` and returns new arrays
- Produces, in `store.js` (all public writes serialized):
  - `addCircuit(day) -> circuit`: `{id, type: 'circuit', rounds: 3, items: []}`, appended to the day
  - `setCircuitRounds(day, circuitId, rounds)`: integer ≥ 1, else throws `'Rounds must be 1 or more'`
  - `addCircuitItem(day, circuitId, exerciseId) -> item`: one empty set
  - existing ops now work on items inside circuits too, through `planshape`: `updateSet`, `removeSet`, `addSet`, `removePlanItem`, `movePlanItem`
    - `addSet` on a circuit item throws `'Circuit exercises have one set; change rounds instead'`
    - `removeSet` refuses to remove the only set
    - `removePlanItem(day, id)` removes a top-level entry (exercise **or circuit**) or an item inside a circuit
    - `movePlanItem(day, id, delta)` moves within the containing list (the day, or the circuit's items)
  - `copyDay` deep-copies circuits with fresh ids for the circuit, its items and their sets
  - `isInPlan` / `deleteExercise` see exercises inside circuits
  - `planHistory` still counts a day as training when it has any entry, so a day with only an empty circuit counts. Acceptable; no change.

- [ ] **Step 1: Failing tests.**
  - `planshape`:
    - `legacy entries are exercises`
    - `flatItems expands circuits in order`
    - `findItem finds nested`
    - `mapItems returns new arrays and leaves the input untouched`
  - `store`:
    - `addCircuit + addCircuitItem + setCircuitRounds`: rounds 4 persists after `boot`, and `0` rejects
    - `updateSet works inside a circuit`
    - `addSet refuses on circuit item`
    - `removePlanItem removes a whole circuit or one item in it`
    - `movePlanItem moves inside the circuit`
    - `copyDay copies circuits with fresh ids`: no shared id at any depth
    - `deleteExercise refuses when used only inside a circuit`
- [ ] **Step 2: Run** `node --test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Replace `findItem`/`withItem` in the store with `planshape`. Keep the write-then-mutate rule and the serial map.
- [ ] **Step 4: Run** `node --test`. Expected: all pass, the 62 existing included.
- [ ] **Step 5: Checkpoint** (ledger line; the user commits).

---

### Task 2: Session — circuits, auto-flow, pause, catch-up

**Files:**
- Modify: `js/session.js`
- Test: `tests/session.test.js` (append)

**Interfaces:**
- Consumes: `planshape.isCircuit`, `timer.elapsedSec`.
- Changes to existing functions (old tests must stay green):
  - `startSession({ planItems /* day entries */, planDay, date, startedAt, nowMs = null })`
    - A circuit expands into one item per circuit exercise: `{exerciseId, planItemId, circuitId, sets: rounds × {planSetId, round, planned, actual, status}}`.
    - Normal entries are unchanged and get `circuitId: null`.
    - If the first step is a circuit step, `run.timerStartedAt = nowMs`.
  - **advance:** the cursor moves to the first pending set in `executionOrder(s)`. If the new current item has a `circuitId`, `timerStartedAt` is the `nowMs` passed in; otherwise `null`. `pausedAt` is reset to `null`. Every function that advances takes `nowMs`: `completeSet`, `endBreak`, and `skipSet(s, nowMs)` / `skipExercise(s, nowMs)`, whose new `nowMs` parameter is optional (default `null`).
  - `completeSet` on a circuit set with a duration sets `actual.duration` to the **target** when `nowMs ≥ start + target`, otherwise to the elapsed time.
  - `addSetToCurrent` and `moveRemaining` are no-ops for circuit items.
  - `diffFromPlan` emits, for circuit items, `{key: 'c' + itemIdx, kind: 'circuit', exerciseId, planItemId, planSetId, from: planned, rounds: SetValue[] /* done rounds' actual */, to}`. In `to`, weight and reps are the minimum over the done rounds (ticked fields only) and duration and break come from `planned`. The row appears only if some done round's ticked weight or reps differs from `planned`. Normal-item rules are unchanged.
  - `applyDiff(entries, rows, makeId)` works on day **entries**:
    - `changed` and `circuit` locate the PlanSet by id anywhere, using `flatItems`
    - `circuit` writes weight and reps only
    - `extraSet` targets the item anywhere
    - `extraExercise` appends at day level
- New exports:
  - `executionOrder(s) -> Array<[itemIdx, setIdx]>`
  - `isCircuitStep(s) -> boolean`: the current item has a `circuitId`
  - `pause(s, nowMs)` and `resume(s, nowMs)`: `resume` adds `nowMs − pausedAt` to `timerStartedAt` and clears `pausedAt`. Both are no-ops when already in that state.
  - `restartStepPaused(s, nowMs)`: if `isCircuitStep(s)` and not finished, set `timerStartedAt = nowMs` and `pausedAt = nowMs` (a full fresh step, paused). Otherwise it returns `s` unchanged.
  - `editDoneSet(s, itemIdx, setIdx, patch)`: merges into `actual` of a **done** set only, else it is a no-op.
  - `tickCircuit(s, nowMs, fieldsOf) -> s`: loops while the current step is a circuit step, **not paused**, and its time has ended:
    - phase `set` with ticked duration and target ≠ null, once `elapsed ≥ target`: `completeSet(s, {}, start + target·1000, fieldsOf)`
    - phase `break` on a circuit item, once `elapsed ≥ break + extraSec`: `endBreak(s, start + (break + extraSec)·1000)`

    It stops at a reps-only circuit step or a normal step. It returns the **same object** when nothing changed, so callers can compare with `===`.

- [ ] **Step 1: Failing tests.** Fixture: Monday entries `[circuit{rounds 2, items: pushups {duration 20, reps 15, break 10}, plank {duration 20, break 10}}, bench {weight 20, reps 12}]`, with fields pushups = duration+reps+break, plank = duration+break, bench = weight+reps.
  - `startSession with mixed entries`: 3 items, the circuit items have `circuitId` and 2 sets with `round` 1 and 2, and `timerStartedAt === nowMs`. Legacy-only entries still work, covered by the existing tests.
  - `executionOrder is round-robin for circuits`: `[[0,0],[1,0],[0,1],[1,1],[2,0]]`
  - `tickCircuit auto-ends work at target then runs the break then starts the next step`
    - start at 0, tick at 20000: pushups round 1 is done with `actual.duration === 20`, phase break, `timerStartedAt === 20000`
    - tick at 30000: cursor on plank round 1, `timerStartedAt === 30000`
  - `tickCircuit catches up several steps with exact timestamps`: the timeline is work 0–20 s, break 20–30 s, work 30–50 s, break 50–60 s, work 60–80 s. A single tick at 65000 marks pushups round 1 and plank round 1 done, with plank `actual.break === 10`. The current step is pushups round 2 work, with `timerStartedAt === 60000`.
  - `tickCircuit waits on reps-only step`: a circuit exercise with reps only, ticked at +10 min, returns the same object.
  - `tickCircuit leaves normal items alone`: at bench it returns the same object.
  - `last circuit step before a normal exercise still gets its break; workout's final set none`: reuses the Plan 2 rule.
  - `pause/resume freezes the clock`: in a break started at 20000, pause at 25000, resume at 85000 gives `timerStartedAt === 80000`. `tickCircuit` while paused returns the same object.
  - `restartStepPaused`: a session mid-circuit gives `timerStartedAt === pausedAt === now`. On a normal step it is unchanged.
  - `editDoneSet only edits done sets`
  - `diffFromPlan circuit row uses lowest done round`: pushups rounds actual reps 17 and 14, planned 15, gives a row with `rounds[].reps` `[17, 14]` and `to.reps === 14`. Plank (duration only) gives no row.
  - `applyDiff writes circuit row into nested item, weight/reps only`
  - `addSetToCurrent and moveRemaining are no-ops on circuit items`
  - `skipExercise in a circuit skips all remaining rounds of that exercise only`
- [ ] **Step 2: Run.** Expected: the new tests FAIL; the old tests still pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test`. Expected: all pass.
- [ ] **Step 5: Checkpoint.**

---

### Task 3: Plan tab — circuit cards

**Files:**
- Modify: `js/plan.js`, `style.css`

**Interfaces:**
- Consumes: the store circuit ops (Task 1), `isCircuit`, the existing `setRow`, `setSummary`, `stepper`, `openTimePicker`, and the exercise picker.

Behaviour (spec §6.3b Plan):
- The day footer gets a `+ circuit` button next to `+ exercise`.
- A circuit card is outlined in `--accent-dim` and has:
  - a header `circuit · N rounds`, up/down at day level, and a two-tap remove
  - expanded: a rounds `stepper` (step 1, min 1)
  - one row per exercise: name, up/down inside the circuit, remove, and below it the existing `setRow` for its single set, with no "remove set" button
  - `+ exercise to circuit`, which opens the picker and calls `addCircuitItem`
- Collapsed summary: the exercise names joined with ` → `, then `· N rounds`.
- Normal cards are unchanged. The Go pre-start list shows a circuit as one row: `circuit · N rounds` plus the names.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Manual check** (laptop, `python -m http.server 8080`, DevTools phone mode):
  - Build "push-ups 20s/15 reps/break 10s → plank 20s/break 10s → mountain climber 20s/break 10s, 3 rounds" on Monday, plus bench below it.
  - Reload: everything is kept.
  - Copy Monday to Thursday.
  - Remove plank from the circuit.
- [ ] **Step 3: Checkpoint.**

---

### Task 4: Go — hands-free circuit screens

**Files:**
- Modify: `js/go.js`, `js/app.js`, `style.css`, `sw.js` (`planshape.js` in `ASSETS`, `CACHE_NAME = 'repkit-v3'`)

**Interfaces:**
- Consumes: the Task 2 session API.
- Produces: `prepareResume()` exported from `go.js`. `app.js` calls it once after `store.boot()`. If `active` is mid-circuit, it applies `restartStepPaused(active, Date.now())` and saves.

Behaviour (spec §6.3b Go):
- Start passes `nowMs: Date.now()` to `startSession`.
- **Every** clock computes "now" as `run.pausedAt ?? Date.now()`.
- **Circuit set screen:**
  - exercise name, `round r / N`, `next: <name>`
  - a big low-tone countdown, with no start-set button and no Done for timed steps
  - reps and kg shown as plain text, with no steppers here
  - a **pause** button that becomes **resume** while paused
  - reps-only circuit step: the existing steppers plus a Done button
- **Circuit break screen:**
  - a big high-tone countdown, `next: …`, and +15s
  - `just now: <exercise>` with steppers for the ticked reps and weight of the set that just ended, pre-filled from its `actual`. Each change calls `editDoneSet`, then `store.saveActive`, **without** a full re-render, so the clock keeps running.
  - **pause / resume**
- **Paused:** the clock is frozen and dimmed, a `paused` label shows, and the resume button is large.
- **Tick loop:** each tick runs `next = tickCircuit(liveSession(), Date.now(), fieldsOf)`. If `next !== liveSession()`, it does `apply(next)`, which persists and re-renders. Otherwise it only updates the clock text and plays cues. On a re-render after the app was backgrounded, that catches up silently (the cue jump rule).
- **Menu:** for circuit items, only skip this set, skip this exercise (all its rounds) and quit. Pass `Date.now()` to `skipSet` and `skipExercise` everywhere.
- **Finish rows** for `kind: 'circuit'`: title `push-ups · circuit`, detail `reps 15 → 17, 14 (plan: 14)`, and the same toggle.
- **Resume banner:** after `prepareResume`, a paused circuit shows "tap resume to continue". The tap also unlocks sound.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Manual check** (laptop in phone mode, or phone over Wi-Fi):
  - Monday circuit: start, and it runs with no taps. Low beep at the end of work, high ticks before the next step.
  - During a break, + reps on the last push-ups: the clock doesn't stutter.
  - Pause for 20 s, then resume: the clock is unchanged.
  - Switch tab or app for 40 s and come back: steps advanced, clock correct, no beep burst.
  - Kill the tab mid-circuit and reopen: paused, full step.
  - After the circuit, bench works as before (start set, overtime, done).
  - Finish: the push-ups circuit row shows the rounds, and update plan writes the lowest.
- [ ] **Step 3: Run** `node --test`. Expected: all pass. Check `ASSETS` against `ls js`.
- [ ] **Step 4: Checkpoint.** Next: Plan 3 (Log + Reports + Export). It must count circuit sets like normal sets.
