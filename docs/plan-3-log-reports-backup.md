# repkit — Plan 3: Log + Reports + Backup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- **Log tab:** a month calendar with done / partial / missed / rest marks and a streak. Tap a day to see its workouts; you can fix a set or delete a workout.
- **Reports tab:** two views with a week/month toggle.
  - Overview: days done, total time, streak, and volume by category.
  - Exercise: best-set trend, plan vs actual, and a "raise it?" hint.
- **Backup:** JSON export and import in settings.

**Architecture:**
- All numbers come from a new **pure** `report-data.js`, tested under Node.
- `store.js` adds session range loading, session edit/delete, and full export/import.
- `backup.js` (pure) builds and validates the backup document.
- The UI modules (`log.js`, `reports.js`, the backup part of settings) only render.

**Tech Stack:** as before. Charts reuse kharchly's `barChart` and `hBars` (`js/charts.js`, already copied).

**Spec:** `repkit/docs/spec.md` §6.4 Log, §6.5 Reports, §8 Backup, §5 (planHistory rule), §6.3b (circuit sets count like normal sets).

## Global Constraints

- Everything in the earlier plans' Global Constraints still applies.
- **Commits: this repo is now under git** (`Naveen1422github/repkit`, public). Commit at each checkpoint with a plain conventional message. No AI attribution trailer. Push at the end of the plan. `.superpowers/` stays gitignored.
- **Training days of a past date come from `planHistory`:** the last entry with `from ≤ date`. Before the first entry, no day is planned. Never derive past marks from the current plan.
- **`firstDay`** is the earliest session `date`. Nothing before it is ever "missed", and streak and consistency never count before it.
- A session counts on its `date` (the start date). A session on a non-planned day counts as a **done day** and never as missed.
- **Volume** is Σ weight × reps over **done** sets that have both. Circuit sets count the same as normal sets. An exercise in several categories counts its full volume in **each** of them. Exercises with no category go under `uncategorized`.
- **Best set:**
  - an exercise that tracks weight: the max weight, ties broken by more reps
  - else reps: the max reps
  - else duration: the max duration
- **Above / equal / below:**
  - per done set with `planned`: **above** means every planned ticked value (weight, reps; duration only for non-circuit sets) is met and at least one is exceeded; **below** means any is lower; otherwise **equal**
  - per session the majority over that exercise's sets decides, with ties going to equal
  - extra sets (`planned === null`) are ignored
- **Hint** "you've beaten your plan N times in a row. raise it?" shows when the exercise's **last 3** sessions were all `above`.
- Reports periods: **week** is Mon–Sun containing the anchor day, **month** is the calendar month. "vs previous" compares with the period right before.
- **Backup file:** `{app: 'repkit', schemaVersion, exportedAt, data: {[kvKey]: value}}`. Every kv key is included. Blobs (`img:*`) are written as data URLs and turned back into Blobs on import. Import:
  - refuses anything that isn't this shape or has `app` other than `'repkit'`
  - refuses a `schemaVersion` newer than the app's
  - otherwise **replaces** all data, clears `active`, then the app re-boots its state

## Review Focus

1. **The plan changed mid-month** (Tuesday added on the 15th). Calendar marks and the streak before the 15th still use the old training days. Pinned by Task 1 test `planned days follow planHistory, not today's plan`.
2. **A workout on a rest day, or one started at 23:50 that ends after midnight.** It counts as done on its start date, is never missed, and doesn't break the streak. Pinned by Task 1 tests `rest-day workout counts as done` and `streak`.
3. **A brand-new user with a plan but no workouts yet**, or days before their first workout. No ✕ marks, streak 0, consistency 0/0 (shown as "–"). Pinned by Task 1 test `nothing is missed before firstDay`.
4. **Importing a random JSON, a kharchly backup, or a file from a newer repkit.** It is refused and the current data stays untouched. Pinned by Task 2 tests `validateBackup refuses foreign/newer/garbage` and `importAll with invalid file changes nothing`.
5. **Plank (no weight), or bench in Chest + Arms.** Plank adds 0 volume; bench counts fully in both. Pinned by Task 1 test `volumeByCategory`.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `js/report-data.js` | pure: planned days, day status, streak, consistency, volume, best set, plan-vs-actual, periods | 1 |
| `js/backup.js` | pure: `validateBackup`, `BACKUP_APP` | 2 |
| `js/store.js` | `loadSessionsRange`, `updateSession`, `deleteSession`, `exportAll`, `importAll` | 2 |
| `js/log.js` | Log tab | 3 |
| `js/reports.js` | Reports tab | 4 |
| `js/app.js`, `js/ctx.js` | route log and reports; view state; settings export/import | 3–5 |
| `style.css`, `sw.js`, `README.md` | styles; `ASSETS` + `CACHE_NAME = 'repkit-v4'`; README mentions backup | 3–5 |
| `tests/report-data.test.js`, `tests/backup.test.js`, `tests/store.test.js` | node tests | 1–2 |

---

### Task 1: report-data (pure)

**Files:**
- Create: `js/report-data.js`
- Test: `tests/report-data.test.js`

**Interfaces:**
- Consumes: `dates.js` (`weekdayKey`, `addDays`, `weekStart`, `daysInMonth`, `monthKey`, `dayDiff`).
- Produces. All take plain data; `sessions` is `Session[]` and `fieldsOf(exerciseId) -> fields`.
  - `trainingDaysOn(planHistory, day) -> string[]`
  - `isPlanned(planHistory, day) -> boolean`
  - `firstDayOf(sessions) -> day | null`
  - `byDay(sessions) -> Map<day, Session[]>`
  - `dayStatus(day, { sessionsOnDay, planHistory, today, firstDay }) -> 'done'|'partial'|'missed'|'rest'|'planned'|'upcoming'`, decided in this order:
    1. any session with status `done`: `'done'`
    2. only partial sessions: `'partial'`
    3. planned, with `firstDay ≤ day < today`: `'missed'`
    4. planned, `day === today`: `'planned'`
    5. planned and in the future, or planned and before `firstDay`: `'upcoming'`
    6. otherwise: `'rest'`
  - `streak(sessions, planHistory, today) -> int`. Walk back from today to `firstDay`:
    - a day with a session adds 1
    - a planned day without a session breaks the streak, except **today**, which never breaks it
    - every other day is skipped
  - `consistency(sessions, planHistory, from, to, today) -> {done, planned}`. Planned days in `[max(from, firstDay), min(to, today)]`, and how many of them had a session. Plus sessions on non-planned days, added to **both** counts.
  - `periodRange(kind: 'week'|'month', anchorDay) -> {from, to}` and `previousPeriod(kind, anchorDay) -> {from, to}`
  - `inRange(sessions, from, to) -> Session[]`
  - `totalSec(sessions) -> int`: Σ (`endedAt − startedAt`) in seconds, parsed as local time
  - `sessionVolume(session, fieldsOf) -> number`
  - `volumeByCategory(sessions, exercises, fieldsOf) -> Array<{categoryId|'uncategorized', kg}>`, sorted descending, zeros dropped
  - `bestSet(sets /* done SetValue actuals */, fields) -> {weight, reps, duration} | null`, using the Global Constraints rule
  - `bestTrend(sessions, exerciseId, fieldsOf, kind: 'week'|'month', count = 8, today) -> Array<{key, label, value}>`. The last `count` periods ending in the current one. `value` is the best set's main number (weight, else reps, else duration), 0 for an empty period. Labels are `dd/mm` of the week start, or `MMM` for months.
  - `planVsActual(sessions, exerciseId, fieldsOf) -> {above, equal, below, streakAbove}`. `sessions` are in date order. `streakAbove` is the number of trailing `above` sessions.

- [ ] **Step 1: Failing tests** (`process.env.TZ = 'Asia/Kolkata'`). The helpers build sessions with `{date, startedAt, endedAt, status, items:[{exerciseId, circuitId, sets:[{planned, actual, status}]}]}`. The tests and their key assertions:
  - `trainingDaysOn picks the latest entry not after the day`: history `[{from:'2026-11-02', trainingDays:['mon']}, {from:'2026-11-15', trainingDays:['mon','tue']}]`. `'2026-11-10'` gives `['mon']`, `'2026-11-17'` gives both, `'2026-11-01'` gives `[]`.
  - `planned days follow planHistory, not today's plan`: Tue 2026-11-10 is not planned, Tue 2026-11-17 is.
  - `dayStatus`: covers all six outcomes. A partial plus a done session on the same day gives done.
  - `nothing is missed before firstDay`: with no sessions every past planned day is `upcoming`, `streak` is 0, and `consistency` is `{done:0, planned:0}`.
  - `rest-day workout counts as done`: a session on an unplanned Wednesday gives status done, adds 1 to the streak, and adds 1 to both consistency counts.
  - `streak`: Mon/Wed/Fri plan with sessions on Mon, Wed, Fri, then today = next Mon with no session yet, gives 3. If the Wednesday session is removed, the result is 1.
  - `consistency over a range`
  - `periodRange/previousPeriod week and month`: anchor Wed 2026-11-25 gives week `2026-11-23..2026-11-29`, previous `2026-11-16..2026-11-22`, month `2026-11-01..2026-11-30`, previous `2026-10-01..2026-10-31`.
  - `totalSec`: `18:00:00` to `18:52:30` gives 3150.
  - `sessionVolume counts done sets with weight and reps, circuits too, skips skipped`
  - `volumeByCategory`: bench (Chest + Arms) `[20×10, 20×10]` gives Chest 400 and Arms 400. Plank gives nothing. An exercise with no category goes under `uncategorized`.
  - `bestSet`: weight ties broken by reps; reps-only; duration-only.
  - `bestTrend`: 3 weeks of bench (best 20, 22.5, 25) give the last 3 values `[20, 22.5, 25]` and earlier empty weeks give 0.
  - `planVsActual`: sessions above, equal, above, above, above give `{above:4, equal:1, below:0, streakAbove:3}`. A below session resets `streakAbove`.
- [ ] **Step 2: Run** `node --test tests/report-data.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: report-data — day status, streak, consistency, volume, best set, plan vs actual`.

---

### Task 2: Store sessions API + backup

**Files:**
- Create: `js/backup.js`
- Modify: `js/store.js`
- Test: `tests/backup.test.js`, `tests/store.test.js` (append)

**Interfaces:**
- `backup.js` (pure):
  - `BACKUP_APP = 'repkit'`
  - `validateBackup(doc, maxSchema) -> { ok: true, data } | { ok: false, error }`. Errors:
    - not an object, or no `data` object: `'not a repkit backup'`
    - `app !== 'repkit'`: `'not a repkit backup'`
    - `schemaVersion > maxSchema`: `'backup is from a newer repkit — update the app first'`
    - `data` missing any of `meta`, `categories`, `exercises`, `plan`: `'backup is incomplete'`
- `store.js` additions. Writes are serialized; reads are not.
  - `loadSessionsRange(fromDay, toDay) -> Session[]`: loads every month touched, filters by `date`, sorts by `startedAt`
  - `allSessions() -> Session[]`: every `sessions:*` key, sorted by `startedAt`. Reports and Log use this for `firstDay` and the streak.
  - `updateSession(session)`: replaces by `id` inside `sessions:<monthKey(date)>`. Throws `'Workout not found'` if it is missing.
  - `deleteSession(session)`
  - `exportAll() -> {app, schemaVersion, exportedAt: nowTsSec(), data}`: every kv key and its value, Blobs left as Blobs (the UI converts them)
  - `importAll(doc)`:
    - `validateBackup` first; on failure throw `error` and change nothing
    - otherwise delete every existing kv key, write every `data` key except `active`, then re-run `boot()`

- [ ] **Step 1: Failing tests:**
  - `validateBackup refuses foreign/newer/garbage`: cases `null`, `'x'`, `{}`, a kharchly-shaped `{schemaVersion:1, data:{items:[]}}`, `app:'repkit'` with schema 99, and `app:'repkit'` missing `plan`. One valid case.
  - `loadSessionsRange spans months and sorts`
  - `updateSession / deleteSession`
  - `exportAll then importAll into a fresh store round-trips`: the exercises, plan, sessions and settings are equal, and `active` is null.
  - `importAll with invalid file changes nothing`: the kv map is identical before and after.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: sessions range/edit/delete + backup export/import in store`.

---

### Task 3: Log tab

**Files:**
- Create: `js/log.js`
- Modify: `js/app.js` (route `log`), `js/ctx.js` (`view.logMonth = monthKey(today)`, `view.logDay = null`), `style.css`, `sw.js`

**Interfaces:**
- Consumes: Task 1 (`dayStatus`, `streak`, `byDay`, `firstDayOf`), Task 2 (`allSessions`, `updateSession`, `deleteSession`), `stepper`, `setSummary`, `formatSec`, `twoTap`.
- Produces: `renderLog() -> HTMLElement`. Because sessions load asynchronously, render a shell, then fill it once `store.allSessions()` resolves. Cache the result on `view` until a session write invalidates it.

Behaviour (spec §6.4):
- Header: `‹ november 2026 ›` (month nav, no future months beyond the current one) and `streak N` on the right.
- A Mon-first 7-column grid. Each day cell shows the day number and a mark:
  - ● done, in the accent colour
  - ○ partial
  - ✕ missed, in `--danger`, dim
  - planned: an underlined number
  - nothing for rest or upcoming days

  Today is outlined. Tapping a day sets `view.logDay`.
- Day detail, below the grid:
  - For each session that day: `<planDay name>` (plus `· instead of <weekday>` when they differ), the duration, and `partial` when partial.
  - Then each item: the exercise name (`· circuit` for circuit items) and its sets as `setSummary(actual, fields without break)`, with skipped sets dimmed and labelled `skipped`.
  - An **edit** toggle shows steppers for weight and reps on done sets. Each change calls `updateSession`.
  - Two-tap **delete workout**.
  - No sessions: `rest day`, `missed` or `planned` as text.

- [ ] **Step 1:** Implement. Add `log.js`, `report-data.js` and `backup.js` to `sw.js` `ASSETS`.
- [ ] **Step 2: Manual check** in Chrome on `127.0.0.1:8080`, which has test sessions from Plan 2b's checks; seed more by running two quick workouts.
  - The calendar marks today ●.
  - Tapping the day shows the sets.
  - Editing a rep persists after a reload.
  - Deleting removes the ●.
  - The month arrows work.
- [ ] **Step 3: Commit** `feat: log tab — calendar, streak, day detail with edit/delete`.

---

### Task 4: Reports tab

**Files:**
- Create: `js/reports.js`
- Modify: `js/app.js` (route `reports`), `js/ctx.js` (`view.report = { seg: 'overview'|'exercise', period: 'week'|'month', exerciseId: null }`), `style.css`

**Interfaces:**
- Consumes: Task 1, `allSessions`, `barChart`, `hBars`, `categoryName`, `formatSec`.
- Produces: `renderReports() -> HTMLElement`, which loads asynchronously the same way as the Log.

Behaviour (spec §6.5):
- Top: a `overview | exercise` segment and a `week | month` toggle.
- **Overview:**
  - Three tiles:
    - `days done`, shown as `done/planned`, or `–` when planned is 0
    - `time`, shown as `Xh Ym` from `totalSec`
    - `streak`
  - `volume by category` as `hBars`. Each row is labelled with the category name and `▲ 12%` / `▼ 5%` / `new` against the previous period. Tapping a row switches to the exercise segment with a picker filtered to that category.
  - Empty: `no workouts this week/month yet`.
- **Exercise:**
  - A picker: a select or chips of exercises that have at least one done set in any session, sorted by name.
  - `best set` as a `barChart` of `bestTrend` (8 weeks or 6 months) with a caption `20 → 27.5 kg over 6 weeks`, using the first and last non-zero values.
  - `vs plan`: `above N · equal N · below N`.
  - The hint when `streakAbove ≥ 3`: `you've beaten your plan N times in a row. raise it?`
  - Empty: `no sets logged for this exercise yet`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Manual check** in Chrome on `127.0.0.1:8080`:
  - The overview tiles match the Log.
  - The week/month toggle works.
  - The exercise picker shows the test exercises.
  - Charts render and fit at phone width.
  - Nothing overflows horizontally at 375px.
- [ ] **Step 3: Commit** `feat: reports tab — overview and exercise views`.

---

### Task 5: Backup UI + wrap-up

**Files:**
- Modify: `js/app.js` (settings), `README.md`, `sw.js` (`CACHE_NAME = 'repkit-v4'`)

Behaviour (spec §8):
- Settings gains a `backup` section with **export** and **import**.
- **Export:**
  - Call `store.exportAll()`.
  - Convert each Blob value to a data URL with `FileReader`.
  - Download as `repkit-backup-YYYY-MM-DD.json` (an `<a download>` with an object URL).
  - Show `exported N workouts`.
- **Import:**
  - Pick the file with a hidden `<input type=file accept="application/json,.json">`, then `JSON.parse`.
  - Convert `data:` strings under `img:*` keys back to Blobs with `fetch(dataUrl).then(r => r.blob())`.
  - Ask for confirmation in-modal: `replace everything on this phone with this backup? (N workouts)`, with a two-tap **replace**.
  - On confirm: `store.importAll`, then `view.tab = 'plan'`, a toast `backup restored`, and a full re-render.
  - Errors, including the validation text, are shown as a toast. Nothing changes.
- README: add a `backup` section saying export lives in settings and Drive backup comes later.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Manual check** in Chrome on `127.0.0.1:8080`:
  - Export downloads the file.
  - Delete a workout, then import the file: the workout is back.
  - Import an invalid JSON: a toast, and nothing changes.
- [ ] **Step 3: Run** `node --test`. Expected: all pass. Check `ASSETS` against `ls js`.
- [ ] **Step 4: Commit** `feat: backup export/import in settings`, then the final review, fixes, and **push**.
