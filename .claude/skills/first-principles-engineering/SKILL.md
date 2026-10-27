# /first-principles-engineering

QBar systems engineering methodology. Load for architecture changes, security work, queue-report logic, data integrity, complex debugging, and any task where the right solution is not immediately obvious.

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

**The data flow in QBar (as of this session):**

```
User submits report
  → client validates (venue ID, level, optional comment)
  → Supabase insert (reports table: venue_id, level, created_at, comment)
  → loadReports() polls on load + after submit
  → allReports[] (raw merged array)
  → computeStatus(venueId, reports) → status string
  → render functions (explore, live, map markers, venue card)
```

Keep this mental model current. If a refactor changes the flow, update it here.

---

## 3. Queue report lifecycle

A submitted report is not ground truth. Design the system to reflect that.

**Explicit lifecycle states:**

```
submitted → [client validation] → stored → fresh → aging → stale → expired
```

**Rules (current implementation, verified):**

| Window | Treatment |
|--------|-----------|
| 0–25 min | Fresh — full weight in computeStatus |
| 25–45 min | Aging — included but should be visually degraded |
| 45 min–2 h | Stale — computeExploreSummary uses 30-min cutoff; explore sort treats as empty |
| > 2 h | Not considered in aggregation |

**computeStatus behavior (verify before changing):**
- Takes the most recent report within the freshness window
- Does NOT average or weight multiple reports
- Returns 'none' when no fresh reports exist

**What this does not yet handle (verified gaps):**
- Duplicate detection: a user can submit the same status for the same venue in quick succession
- Outlier resistance: a single "long" report when all others say "free" is taken at face value
- Confidence signal: one report has the same display weight as ten independent reports

When improving aggregation, start simple. A recency-weighted median over the last 3 fresh reports is more robust than the current last-report-wins approach and still explainable. Introduce complexity only when a simpler method demonstrably fails.

---

## 4. Freshness and uncertainty

This is QBar's hardest product problem. Communicate it honestly in every layer.

**Principles:**
- A report from 5 minutes ago outweighs three reports from 75 minutes ago.
- Conflicting reports are information, not noise. Surface the tension.
- Stale data must be visually degraded — dimmed, timestamped, labeled.
- No data is not a failure. Show it honestly as "Ingen data".
- Never invent a queue duration when evidence is insufficient.

**Display rules:**
- Fresh + single report: show status with hedged language ("Verkar kort kö")
- Fresh + agreement (≥ 2 reports same level): show with confidence
- Fresh + conflict (reports disagree on level): show most recent, add uncertainty indicator
- Aging (25–45 min): dim the status, show age prominently
- Stale / expired: show empty state — "Senast: X min sedan" as context only

**Language:** "~15 min" not "15 min". Swedish: "Verkar...", "Troligtvis...", "Ingen aktuell data".

---

## 5. Queue estimation — what to measure before changing

Before modifying `computeStatus` or the aggregation logic:

1. Print `allReports` for one venue and read it. What does the raw data look like?
2. How many reports does a typical active venue have in a 25-minute window?
3. What is the median report age at time of display?

Current method: last-report-wins (most recent report within window). Weaknesses:
- One outlier report immediately replaces all prior signals
- No minimum evidence threshold
- No confidence quantification

Better method (implement only when measurably needed):
```
function computeStatusRobust(venueId, reports) {
  var window = Date.now() - 25 * 60 * 1000;
  var fresh = reports
    .filter(r => r.venue_id === venueId && new Date(r.created_at) > window)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!fresh.length) return { status: 'none', confidence: 0, count: 0 };
  // Weight: 1.0 for < 10 min, decay linearly to 0.3 at 25 min
  // Take weighted majority across fresh reports
  // Return { status, confidence: 0–1, count, latestAge }
}
```

Do not show artificial confidence percentages. Use thresholds: low / medium / high.

---

## 6. Security — layered model

**Map the actual architecture first. Do not assume.**

QBar's current security boundary (verified):
- Frontend: `index.html` — client-side JS, visible to all users
- Backend: Supabase (PostgreSQL + REST API via `@supabase/supabase-js`)
- Auth: anonymous (no login) — the Supabase anon key is embedded in client code
- RLS: unknown until inspected — **verify before assuming policies exist**

**Layer 1 — Input validation**

Current client-side validation (verified in `submitReport`):
- Checks that `selectedRV` is a valid venue ID from VENUES array
- Checks that level is one of: free/short/medium/long
- Validates comment length (80 chars max)

**Gap**: all validation is client-side. A direct Supabase API call bypasses it entirely.

Fix: add Supabase Row Level Security policies that enforce the same constraints server-side. This is the highest-priority verified security gap.

**Layer 2 — Authorization**

Current state: anonymous submissions, no user identity.
- Anyone can submit any status for any venue
- No authentication required
- Rate limiting: none (verified gap)

For anonymous apps, the practical defense is rate-limiting + duplicate detection, not auth.

**Layer 3 — Rate limiting and spam**

Current state: none (verified).

Minimum viable protection:
```js
// Client-side cooldown (UX only, not a security boundary)
var _lastReportTime = {};
function canSubmitReport(venueId) {
  var last = _lastReportTime[venueId] || 0;
  return Date.now() - last > 5 * 60 * 1000; // 5 min per venue
}
```

Server-side rate limiting requires Supabase Edge Functions or a middleware layer.

**Layer 4 — Coordinated manipulation**

Signal: multiple reports for the same venue within a short window all claiming the same extreme status.

Detection approach (implement in aggregation, not UI):
- Flag a venue's estimate when ≥ 3 reports arrive within 5 minutes
- Weight flagged reports at 0.5 until independent reports confirm
- Log the flag for investigation, do not silently discard

Do not permanently penalize reporters based on one event.

**Layer 5 — Operational resilience**

Current failure modes (verified):
- Supabase unavailable → `loadReports()` fails → `allReports` stays empty → empty state shown (correct)
- Mapbox unavailable → map fails to load → no graceful fallback to explore list
- Network loss mid-report → submit fails → user sees error toast (verify this actually fires)

Never expose Supabase keys beyond the public anon key. The anon key is intentionally public but must be URL-restricted in Supabase dashboard settings.

**Layer 6 — Privacy**

Current data collected per report: `venue_id`, `level`, `created_at`, optional `comment`.
- No user identity stored
- No IP address stored in client-visible data
- Location used client-side only (distance calculation, "på väg" mode) — not transmitted

Before adding any new data collection, justify the necessity.

---

## 7. Search — architecture rules

QBar has three search surfaces sharing one implementation (`venueSearch`):
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
1. Run the node test in the last search commit to establish a baseline.
2. Add the failing case as a new test assertion.
3. Fix the algorithm.
4. Verify all prior assertions still pass.

---

## 8. Deterministic vs. AI

Use deterministic algorithms by default for QBar. They are:
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
- Never commit `.env` or any private key. The Supabase anon key in HTML is intentionally public (URL-restricted).

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
