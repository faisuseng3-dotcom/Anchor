# /bug-fix

Systematic bug investigation. Never guess — find evidence before changing code.

## Trigger

`/bug-fix [description of symptom]`

## Process

### PHASE 1 — REPRODUCE
Before touching code, understand the exact failure:
- What is the observed behavior?
- What is the expected behavior?
- Does it happen with `?testdata=true`?
- Does it happen with no data (supabase=null)?
- Is it a render bug, data bug, or logic bug?

### PHASE 2 — LOCATE
Search for the symptom's source:

**Render bug** (wrong display, missing element, wrong color):
- Find the render function responsible for that UI element
- Read it in full — do not scan, read
- Trace the data flow: where does the value come from?

**Data bug** (wrong wait time, wrong status, wrong sort order):
- A wrong wait time starts at `estimateWait`, not at the render function. Every wait time on
  every screen goes through `venueWaitText`; `formatWait` only formats what `estimateWait` gave
- `computeStatus` classifies for colour and label. It calls `estimateWait` first and only falls
  back to reported `queue_status` values. See `getStatusClass` and `STATUS_COLORS` for the class
  and the hex
- Check whether `allReports` is filtered correctly (45-min cutoff, venue_id match, `isQueueReport`)
- Check whether `injectTestData` is producing the expected data

**Logic bug** (wrong trend, wrong sort, wrong animation):
- Find the specific logic block
- Trace through with the values in `injectTestData` — read them there, do not trust a list in a
  document. A per-venue status is derived from the clock, `PACE_RATE` and the seeded rows, so it
  changes without anyone editing the docs.

What IS stable in `injectTestData`, because it is the shape of the seed data:

| Seeded as | Venues |
|---|---|
| Measured queue sessions (initial → followup → entered) | `spy-bar`, `under-bron`, `drama` |
| No queue at all (`people_ahead` = 0) | `tjoget`, `morfar-ginko`, `solidaritet` |
| Only initial reports, so the estimate comes from the pace prior | `cafe-opera`, `berns`, `sturehof`, `pelikan` and the rest |
| Deliberately aged, to exercise the stale state | `gro` |

### PHASE 3 — KNOWN HISTORICAL BUGS (check these first)
These bugs have occurred before and may recur:

1. **Blank Utforska**: `opacity: 0 !important` on `.erow--empty` blocks animation
   - Fix: encode opacity in keyframe `to` state via `@keyframes rowInEmpty`, never set directly on `.erow--empty` outside `prefers-reduced-motion`

2. **Animation not firing on re-render**: element already has class, animation doesn't restart
   - Fix: remove class → `void el.offsetWidth` (force reflow) → re-add class

3. **Wrong status shown**: `computeStatus` measures freshness from `created_at`, not `expires_at`
   - Check: is the report inside the 45-minute window measured from `created_at`?
   - `expires_at` is written as `created_at` + 45 min in `submitReport` and only decides what
     `loadReports` fetches at all

4. **Sort order wrong**: venues without data must sort LAST, never interleaved
   - Check: empty venues are ordered with `localeCompare(b.name, 'sv')`, venues with data by
     newest report first. Both rules live in `renderExploreVenues`

5. **Intro animation fires on every re-render**: the flag is consumed at the wrong moment
   - The flag is `_listIntro`. It must be consumed by the draw the user actually sees, which is
     why the guard checks `currentScreen === 'explore'` — the first draw happens behind the map
   - For a repeating animation, the fix is instead: remove class → `void el.offsetWidth` → re-add

### PHASE 4 — FIX
Constraints:
- Minimum change that fixes the bug
- Do not refactor surrounding code while fixing
- Do not rename variables
- Do not change behavior of unaffected features

### PHASE 5 — VERIFY
```bash
npm run verify
```

That is the whole chain: unit tests, `scripts/check.js`, `scripts/check-context.js` and the
build. Running only one part proves only that part.

Test the specific scenario that exhibited the bug.
Test the inverse (does the working case still work?).

### PHASE 6 — CAPTURE
If this bug reveals a new failure pattern:
- Add a check to `scripts/check.js` — it catches deletions and convention breaks
- Add a unit test under `tests/` if the bug was a wrong calculation; `check.js` cannot catch those
- Add the pattern to `CLAUDE.md` under "Mönster från tidigare sessioner"
