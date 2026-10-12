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

**Data bug** (wrong count, wrong status, wrong sort order):
- Add a `console.log` mentally — what would it print?
- Check `computeStatus()`, `getStatusClass()`, `STATUS_COLORS`
- Check whether `allReports` is filtered correctly (cutoff windows, venue_id match)
- Check whether `injectTestData()` is producing the expected data

**Logic bug** (wrong trend, wrong sort, wrong animation):
- Find the specific logic block
- Trace through with the testdata values from CLAUDE.md
- Known testdata: spy-bar→long, sturehof→medium, tjoget→short, morfar-ginko→free, pelikan→long

### PHASE 3 — KNOWN HISTORICAL BUGS (check these first)
These bugs have occurred before and may recur:

1. **Blank Utforska**: `opacity: 0 !important` on `.erow--empty` blocks animation
   - Fix: encode opacity in keyframe `to` state via `@keyframes rowInEmpty`, never set directly on `.erow--empty` outside `prefers-reduced-motion`

2. **Animation not firing on re-render**: element already has class, animation doesn't restart
   - Fix: remove class → `void el.offsetWidth` (force reflow) → re-add class

3. **Wrong status shown**: `computeStatus()` uses `expires_at` not `created_at` for freshness
   - Check: is the report actually within the staleness window?

4. **Sort order wrong**: venues with data sorting after venues without
   - Check: `allReports.some()` vs `allReports.filter()` — `.some()` is O(n) not O(n²)

5. **CountUp animation fires on re-render**: `_exsumFirstRender` not reset properly
   - Check: `_exsumFirstRender = true` is at declaration, not inside `renderExploreVenues`

### PHASE 4 — FIX
Constraints:
- Minimum change that fixes the bug
- Do not refactor surrounding code while fixing
- Do not rename variables
- Do not change behavior of unaffected features

### PHASE 5 — VERIFY
```bash
node scripts/check.js
```

Test the specific scenario that exhibited the bug.
Test the inverse (does the working case still work?).

### PHASE 6 — CAPTURE
If this bug reveals a new failure pattern:
- Add a check to `scripts/check.js`
- Add the pattern to `CLAUDE.md` under "Patterns learned from past sessions"
