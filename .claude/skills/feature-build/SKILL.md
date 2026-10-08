# /feature-build

Build a new feature end-to-end with full verification. Use for any non-trivial addition.

## Trigger

`/feature-build [description]`

## Process

### PHASE 1 — UNDERSTAND
Determine:
- What is the feature?
- Which screen(s) does it affect? (`#screen-home`, `#screen-explore`, `#screen-live`, `#screen-profile`)
- What user problem does it solve?
- What data does it need? (from `allReports`, `VENUES`, Supabase, user input?)
- Does it need a new render function, or extend an existing one?

### PHASE 2 — INSPECT
Before writing a line:
- Read the affected screen's HTML section
- Read the affected render function(s) in full
- Check for existing utilities that cover the need:
  - `computeStatus(venueId, reports)` — status from reports
  - `getStatusClass(status)` — CSS class
  - `STATUS_COLORS` — status → hex
  - `STATUS_RANK` — status → numeric for trend/comparison
  - `renderSparkline()` — mini chart
  - `formatAbsTime()` — HH:MM formatter
  - `computeExploreSummary()` — aggregate stats
- Check whether CSS variables or existing classes cover the styling need

Do not invent what already exists.

### PHASE 3 — PLAN (output before implementing)
```
Feature: [name]
Affected: [files/functions/lines]
New CSS: [class names, brief description]
New JS: [function names, brief description]
Data source: [allReports / VENUES / Supabase / user input]
Reuses: [existing utilities]
Does NOT change: [list what stays untouched]
Estimated lines added: [rough count]
```

Wait for confirmation if the plan involves:
- changing shared render functions used by multiple screens
- adding a Supabase query
- changing the VENUES array structure
- changing CSS variables

### PHASE 4 — IMPLEMENT
Order of operations:
1. CSS first (new classes only, no modifying existing classes unless necessary)
2. JS utilities/helpers
3. Render function changes
4. HTML structure changes (if any)
5. Wire-up (event listeners, call sites)

Constraints:
- Single file (`index.html`) — all changes go here
- No external dependencies beyond existing CDNs
- New CSS classes use kebab-case with a feature prefix (e.g. `.exsum-`, `.erow-`, `.lf-`)
- New JS functions use camelCase
- Do not introduce `let`/`const` if the file uses `var` — match existing style

### PHASE 5 — VERIFY
```bash
node scripts/check.js
```

If new patterns are introduced that should be permanent:
- Add a check to `scripts/check.js`
- Add the pattern to `CLAUDE.md` under "Patterns learned"

### PHASE 6 — SELF-REVIEW
Before reporting done, answer:
1. Does it work with testdata (`?testdata=true`)?
2. Does it work with zero data (empty state)?
3. Does it match the design system (Zilla Slab, status colors, border not shadow)?
4. Is there any redundant information on the same card?
5. Does sorting still work correctly (active venues first)?

### PHASE 7 — COMMIT
```bash
git add index.html
git commit -m "[imperative title]

[body: what and why]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MPy84B9aXUBmuBJs5cHVmD"
git push -u origin claude/queuebar-expo-setup-do34fo
```
