# /first-principles-engineering

QueueBar systems engineering methodology. Load for architecture changes, security work, queue-report logic, data integrity, complex debugging, and any task where the right solution is not immediately obvious.

## Trigger

`/first-principles-engineering` or auto-load when the task involves:
- How queue reports are collected, validated, aggregated, or expired
- Security, authorization, input validation, rate limiting, or spam
- Architecture decisions affecting data flow
- A bug whose root cause is not yet established
- Any proposal to add a new backend dependency, table, or service

Do NOT load for routine CSS changes, copy edits, or UI tweaks with a clear known solution.

---

## 1. Problem-first, not solution-first

Before writing code, answer these in order:

1. What is the actual problem? (Not the symptom. The cause.)
2. What is the simplest solution that is demonstrably reliable?
3. What information does the system need to solve it?
4. What assumptions am I making — and what happens when they are wrong?
5. How will I verify that the solution works?
6. Does this improve the user's decision, or just add complexity?

If you cannot answer question 1 clearly, investigate before proposing anything.

---

## 2. Understand the system before changing it

For any non-trivial change:

1. Read `CLAUDE.md` and this skill first.
2. Trace the data flow: venue creation → report submission → storage → aggregation → display.
3. Identify what currently exists. Do not duplicate working code.
4. Run `node scripts/check.js`. A failing baseline check means the system is already broken.
5. Identify the most consequential verified weakness — not a hypothetical.

**The data flow in QueueBar (verified in `src/main.js`):**

```
User picks a venue and HOW MANY PEOPLE ARE AHEAD — never a status level
  → submitReport: venue from getVenueById, people_ahead, optional comment
  → queue_status is DERIVED, not chosen: waitToStatus(estimateWait(...))   :1439
  → Supabase insert: venue_id, venue_name, queue_status, user_id, people_ahead,
                     report_type, queue_session, expires_at (= now + 45 min), comment
  → loadReports() — 30 s poll + Realtime + after submit; keeps known venue_id only
  → allReports[]
  → estimateWait() → formatWait() → venueWaitText()
  → map · explore · live · venue card   (all through venueWaitText)
```

`venueWaitText(venueId)` is the only path to a wait time on any screen. Keep it that way.
`getStatusLabel()` returns fixed strings and is ONLY a fallback for old reports that carry no
`people_ahead`.

Keep this mental model current. If a refactor changes the flow, update it here.

---

## 3. Queue report lifecycle

A submitted report is not ground truth. Design the system to reflect that.

**Explicit lifecycle states:**

```
submitted → [client validation] → stored → fresh → aging → expired
```

There is no separate "stale but still shown" state: `expires_at` is `created_at + 45 min`, the
same boundary the model uses, so a report leaves the data and the display at the same moment.

**Rules (verified in `src/main.js`):**

| Window | Treatment |
|--------|-----------|
| 0–45 min | Fresh — counted by `estimateWait` (`:307`) and `venueFreshStatus` (`:2121`) |
| 15–45 min | Aging: colour fades, age is shown with "· äldre" (`isAging`, `:2200`) |
| > 45 min | `expires_at` has passed; `loadReports` only reads non-expired rows (`:1443`) |

**Naming trap:** the CSS class `.erow--stale` is set by the variable `isAging`, not `isStale`
(`:2217`). `isStale` means ≥45 min, and a row that old renders as `.erow--empty` instead
(`:2201–2202`). Read the variable, not the class name.

**45 minutes is the only freshness boundary in the code.** There is no 25-minute window and no
30-minute cutoff anywhere. The model and the summary line use the same number on purpose.

**`computeStatus(venueId, reports)` — what it actually does (`:405`):**
- Calls `estimateWait` first. If that returns an estimate, the status is `waitToStatus(est)`.
- Only when `estimateWait` returns null does it fall back to reported `queue_status` values:
  a majority vote across reports fresher than 45 min, else the single most recent report.
- Returns `'unknown'` — not `'none'` — when the venue has no usable reports.

It is a status classifier for colour and label. The wait time itself comes from `estimateWait`.

**What the system does not yet handle (verified gaps):**
- Duplicate detection: two users can report the same venue seconds apart; nothing merges them
- Outlier resistance: one extreme `people_ahead` moves the estimate at face value
- Confidence signal: `computeConfidence` exists but is dead code — nothing displays confidence

---

## 4. Freshness and uncertainty

This is QueueBar's hardest product problem. Communicate it honestly in every layer.

**Principles:**
- A report from 5 minutes ago outweighs three reports from 75 minutes ago.
- Conflicting reports are information, not noise. Surface the tension.
- Stale data must be visually degraded — dimmed, timestamped, labeled.
- No data is not a failure. Show it honestly as "Ingen data".
- Never invent a queue duration when evidence is insufficient.

**Display rules:**
- Fresh + single report: show status with hedged language ("Verkar kort kö")
- Fresh + agreement (≥ 2 reports same `queue_status`): show with confidence
- Fresh + conflict (reports disagree): show the estimate, add an uncertainty indicator
- Aging (15–45 min): dim the status, show age prominently
- Stale / expired: show empty state — "Senast: X min sedan" as context only

**Language:** "~15 min" not "15 min". Swedish: "Verkar...", "Troligtvis...", "Ingen aktuell data".

---

## 5. Queue estimation — what to measure before changing

The wait time is `people ahead ÷ door rate`. It is not a vote over reported statuses.
Read `docs/QUEUE_LOGIC.md` before touching it.

**The block from `PACE_RATE` to `getStatusLabel` in `src/main.js` is the core of the app.**
Do not change it unless changing it is the task. It is covered by the unit tests in `tests/`.

Three rate layers, in order of preference (`estimateWait`):
1. Tonight's measured sessions for this venue — `measureQueueRates`, 45-min window
2. Same weekday ±1 h with ≥3 sessions — `historicalRateFor`
3. The `venue.pace` prior — weighs as 2 sessions, so it is deliberately slow to move

Before proposing any change, measure:
1. Print `allReports` for one venue. What do the raw rows actually look like?
2. Run `qbCalibration()` in the console: median error, bias, share inside the range.
   A positive bias means the app promised a shorter wait than reality.
3. How many measured sessions does an active venue really have within 45 minutes?

Change the model when calibration shows it is wrong — not because another method sounds more
principled. Do not show artificial confidence percentages. Use thresholds: low / medium / high.

---

## 6. Security — layered model

**Map the actual architecture first. Do not assume.**

QueueBar's current security boundary (verified):
- Frontend: `src/main.js` — all client-side JS, visible to all users. `index.html` is only the shell
- Backend: Supabase (PostgreSQL + REST API via `@supabase/supabase-js`)
- Auth: anonymous (no login) — the Supabase anon key is embedded in client code
- RLS: unknown until inspected — **verify before assuming policies exist**

**Layer 1 — Input validation**

Current client-side validation (verified in `submitReport`, `src/main.js:1427`):
- The venue comes from `getVenueById(id)` and the flow aborts on `if (!selectedRV) return`
  (`:3015`, `:3025`), so a venue outside VENUES cannot be picked through the UI
- There is NO status validation, because the user never picks one — `queue_status` is derived
  by `waitToStatus(estimateWait(...))` (`:1439`)
- `people_ahead` is not range-checked in JS; it comes from fixed buttons in the UI
- Comment length is capped by `maxlength="80"` in `index.html:126` — an HTML attribute, not a
  JS check, so a direct API call ignores it

**Gap**: all validation is client-side. A direct Supabase API call bypasses it entirely.

Fix: add Supabase Row Level Security policies that enforce the same constraints server-side. This is the highest-priority verified security gap.

**Layer 2 — Authorization**

Current state: anonymous submissions, no user identity.
- Anyone can submit a report for any venue
- No authentication required; `user_id` is generated client-side and proves nothing
- Rate limiting exists — see Layer 3. Do not add a fourth limit without reading them

For anonymous apps, the practical defense is rate-limiting + duplicate detection, not auth.

**Layer 3 — Rate limiting and spam**

Three limits already exist. Do not re-invent them:

| Limit | Where | Value |
|---|---|---|
| Between initial reports, per user, across ALL venues | `src/main.js:1431` | 20 min |
| Between follow-ups inside a queue session | `src/main.js:1479` (`QS_MIN_GAP`) | 4 min |
| Server-side rejection | error path at `src/main.js:1469` (`rate_limited`) | **VERIFIERA** |

The first two are client-side: UX, not a security boundary. A direct API call bypasses both.

The server limit is real — the client has a dedicated error path for `rate_limited` — but its
value is not in this repo. `CLAUDE.md` states 3 min for follow-ups. **VERIFIERA in the database
before relying on it:** no SQL is under version control (known debt 1), so no policy or trigger
can be read from here.

**Layer 4 — Coordinated manipulation**

Signal: multiple reports for the same venue within a short window all claiming the same extreme status.

Detection approach (implement in aggregation, not UI):
- Flag a venue's estimate when ≥ 3 reports arrive within 5 minutes
- Weight flagged reports at 0.5 until independent reports confirm
- Log the flag for investigation, do not silently discard

Do not permanently penalize reporters based on one event.

**Layer 5 — Operational resilience**

Current failure modes (verified):
- Supabase unavailable → `_loadState = 'error'` → "Ingen kontakt med servern", and rows that
  already loaded are KEPT (`renderLoadFailure`). A server failure must never read as a quiet
  night — see the four load states in `CLAUDE.md`
- Mapbox error → `map.on('error')` sets `map = null` and calls `showMapError` (`:1194`). An
  error state IS shown, but ANY error kills the map permanently, including a single dropped
  tile request (known debt 6)
- Network loss mid-report → submit fails → user sees error toast (verify this actually fires)

Never expose Supabase keys beyond the public anon key. The anon key is intentionally public but must be URL-restricted in Supabase dashboard settings.

**Layer 6 — Privacy**

Current data collected per report: `venue_id`, `venue_name`, `queue_status`, `people_ahead`,
`report_type`, `queue_session`, `user_id`, `created_at`, `expires_at`, optional `comment`.
- `user_id` is an anonymous id generated and stored on the device (`getUserId`), not a login
- `select('*')` in `loadReports` returns other users' `user_id` to every client —
  **VERIFIERA** whether RLS should restrict that column
- No IP address stored in client-visible data
- Location used client-side only (distance calculation, "på väg" mode) — not transmitted

Before adding any new data collection, justify the necessity.

---

## 7. Search — architecture rules

QueueBar has three search surfaces sharing one implementation (`venueSearch`):
- Map inline dropdown
- Explore list filter
- Report venue picker

**The shared `venueSearch(query, venues)` function must:**
- Score every venue against the query (not filter with boolean include/exclude)
- Use length-gated match tiers to prevent single-char flooding
- Return venues sorted by score descending
- Never hardcode specific venue names or letters

**Score tiers (verified current implementation):**

| Score | Match type | Min query length |
|-------|-----------|-----------------|
| 100 | Exact name | 1 |
| 90 | Name prefix | 1 |
| 70 | Word-start in name | 1 |
| 85 | Compact prefix ("spybar"→"Spy Bar") | 2 |
| 60 | Compact contains | 3 |
| 50 | Name substring | 2 |
| 40/30 | Area prefix/contains | 2/3 |
| 20 | Address substring | 3 |
| 10 | Fuzzy char sequence | 3 |
| -1 | No match | — |

**Before modifying search:**
1. Run `npx vitest run tests/search.test.js` to establish a baseline.
2. Add the failing case as a new assertion in that file.
3. Fix the algorithm.
4. Run `npm run verify` and confirm every prior assertion still passes.

---

## 8. Deterministic vs. AI

Use deterministic algorithms by default for QueueBar. They are:
- Explainable to users and developers
- Testable with exact assertions
- Reproducible across environments
- Not dependent on external API availability

**Deterministic is correct for:**
- Search matching and ranking
- Input validation
- Rate limiting
- Report freshness and expiration
- Queue aggregation (current and improved versions)
- Authorization and security rules
- Sorting and filtering

**AI may add value for (evaluate case by case):**
- Natural-language comment moderation
- Anomaly detection across many venues simultaneously

**Before using AI, verify:**
1. The problem cannot be solved reliably by a deterministic algorithm
2. There is a clear fallback when the AI service is unavailable
3. The AI does not make authorization decisions
4. The AI does not fabricate queue information
5. Privacy implications are understood

---

## 9. Hypothesis-driven development

For every non-trivial change:

```
Observe  →  Hypothesize  →  Minimal change  →  Test  →  Inspect  →  Iterate
```

**Observe**: what does the system actually do? Print raw data. Trace the function call. Read the output.

**Hypothesize**: what is causing the behavior? State it as a falsifiable claim.

**Minimal change**: the smallest code change that tests the hypothesis. Do not refactor everything while testing one thing.

**Test**: run `node scripts/check.js`. Then test the specific behavior manually or with a targeted node script. State what you expected and what you observed.

**Inspect**: did the hypothesis hold? If not, revise it — do not patch around it.

**Iterate**: one cycle at a time. Do not layer five hypotheses into one commit.

---

## 10. Risk prioritization

When multiple issues exist, rank by:

1. **Data integrity failures** — system shows false or invented information to users
2. **Security vulnerabilities** — verified attack path with real consequence
3. **Core user journey broken** — cannot submit report, cannot see status, search returns nothing
4. **Trust erosion** — stale data shown as fresh, uncertainty hidden
5. **UX friction** — slow, confusing, or incomplete flows
6. **Polish** — visual inconsistency, minor copy, spacing

Address highest rank first. Do not polish while data integrity is broken.

**Distinguish verified from hypothetical:**
- Verified: you can demonstrate the failure in the current code
- Hypothetical: you believe it could happen but cannot yet demonstrate it

Only act on verified issues in Phase C. Document hypotheticals for future investigation.

---

## 11. Safe implementation rules

- One concern per commit. Do not mix security fixes with feature additions.
- Run `node scripts/check.js` before and after every change. A regression is a blocker.
- Test the failure case, not just the success case. If you added rate limiting, verify it actually blocks the second submission.
- Do not claim a security control works until you have sent the request it is supposed to block.
- Preserve working behavior. When refactoring aggregation, verify `?testdata=true` still renders correctly.
- Never commit `.env` or any private key. The Mapbox token, Supabase URL and anon key sit in
  plain text in `src/main.js`. That is intentional and safe ONLY if RLS is correct — which is
  unverified (`CLAUDE.md`, known debt 1).

---

## 12. Repeatable workflow

```
Phase A — Inspect
  Read CLAUDE.md. Read relevant code section. Trace data flow. Run check.js.

Phase B — Diagnose
  State the verified problem. Distinguish it from hypotheticals.
  Form a falsifiable hypothesis about the cause.

Phase C — Implement
  Make the smallest change that addresses the verified problem.
  Do not refactor unrelated code. Do not add features.

Phase D — Verify
  Run check.js. Test the specific behavior. Test failure cases.
  State what you expected, what you observed, and whether they match.
  If they do not match, return to Phase B.

Phase E — Reassess
  With the fix in place, what is the next highest-risk verified issue?
  Document unresolved findings for the next session.
```

---

## Relationship to other skills

| Skill | When to use |
|-------|-------------|
| `/first-principles-engineering` | This file — architecture, security, data integrity, complex debugging |
| `/fintech-product-thinking` | UI/UX decisions, information hierarchy, what to show and when |
| `/ui-audit` | Structured per-screen audit producing P0–P3 findings |
| `/feature-build` | Implementing a known, approved feature end-to-end |
| `/anti-ai-design` | Removing decorative patterns that erode trust |
| `/release-check` | Pre-deploy verification checklist |

These skills are complementary. A security fix uses this skill for diagnosis and `/feature-build` for implementation discipline. A new reporting feature uses `/fintech-product-thinking` for design and this skill to verify data integrity.
