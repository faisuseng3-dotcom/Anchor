# /feature-build

Build a new feature end-to-end with full verification. Use for any non-trivial addition.

## Trigger

`/feature-build [description]`

## Process

### PHASE 1 — UNDERSTAND
Determine:
- What is the feature?
- Which screen(s) does it affect? (`#screen-home`, `#screen-explore`, `#screen-live`,
  `#screen-report`, `#screen-profile`)
- What user problem does it solve?
- What data does it need? (from `allReports`, `VENUES`, Supabase, user input?)
- Does it need a new render function, or extend an existing one?

### PHASE 2 — INSPECT
Before writing a line:
- Read the affected screen's HTML section
- Read the affected render function(s) in full
- Check for existing utilities that cover the need:
  - `venueWaitText(venueId)` — **the only way to put a wait time on screen.** Never build another
  - `estimateWait` / `formatWait` — what `venueWaitText` is built on. Read, do not reimplement
  - `computeStatus(venueId, reports)` — status for colour and label
  - `getStatusClass(status)` — CSS class · `getStatusColor(status)` — status → hex
  - `STATUS_RANK` — status → numeric for trend/comparison
  - `computeExploreSummary()` — aggregate stats · `exsumText(d, state)` — formats them
  - `escapeHtml` — mandatory for any database text going into an HTML string
  - `timeAgo` — relative time
- Check whether CSS variables or existing classes cover the styling need

Do not invent what already exists. Equally: do not reuse `computeConfidence`,
`renderSparkline`, `renderVenueCard`, `formatAbsTime` or `toggleWatch` — they are defined but
never called, and building on dead code means debugging two things at once.

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
- JS goes in `src/main.js`, CSS in `src/style.css`, markup in `index.html`. `index.html` is the
  shell: it holds the screen containers and the static controls, not the logic
- No new dependency. Mapbox and Supabase come through npm, not a CDN
- **Any function used in an inline `onclick` must be added to `Object.assign(window, …)` at the
  bottom of `src/main.js`.** ES modules have no global scope, so without it the click throws
  `ReferenceError` — silently, until someone presses it. `scripts/check.js` fails the build on a
  literal handler that is missing, but handlers built from a variable are not checked
- New CSS classes use kebab-case with a feature prefix (e.g. `.exsum-`, `.erow-`, `.lv-`)
- New JS functions use camelCase
- Do not introduce `let`/`const` where the file uses `var` — match the surrounding style

### PHASE 5 — VERIFY
```bash
npm run verify
```

Unit tests, `scripts/check.js`, `scripts/check-context.js` and the build. The pre-commit hook
runs the same chain, so a commit that skips it will be rejected anyway.

If new patterns are introduced that should be permanent:
- Add a check to `scripts/check.js`
- Add a unit test under `tests/` if the feature calculates anything — `check.js` only proves
  that code exists, never that it computes correctly
- Add the pattern to `CLAUDE.md` under "Mönster från tidigare sessioner"

### PHASE 6 — SELF-REVIEW
Before reporting done, answer:
1. Does it work with testdata (`?testdata=true`)?
2. Does it work with zero data (empty state)?
3. Does it match the design system — Satoshi, the status colours from `getStatusColor`, border
   and not shadow? **VERIFIERA** before citing a second typeface: `--font-mono` in
   `src/style.css` is aliased to `--font-base`, so numbers render in Satoshi today even though
   `CLAUDE.md` names Geist Mono
4. Is there any redundant information on the same card?
5. Does sorting still hold — venues with data by newest report first, empty venues last?

### PHASE 7 — COMMIT
Stage the files you actually changed — typically `src/main.js`, `src/style.css` and
`index.html`. Never `git add -A`: it picks up scratch files and test artefacts.

Use the commit convention in `CLAUDE.md`, and push to the branch this session was given.
Never push to `main` and never open a pull request unless you were asked to.
