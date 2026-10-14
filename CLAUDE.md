# QueueBar — Claude Project Memory

## What this project is

Single-file web app (`index.html`) for real-time queue status at Stockholm bars and clubs.
Vanilla JS + CSS, no framework, no build step. Mapbox GL JS + Supabase via CDN.
Deployed on Vercel. Branch: `claude/queuebar-expo-setup-do34fo` → merge to `main` for deploy.

## Architecture

- **One file**: all HTML, CSS, JS in `index.html`. Never split into separate files without asking.
- **Screens**: `#screen-home` (map), `#screen-explore` (list), `#screen-live` (feed), `#screen-profile`
- **Data flow**: `loadReports()` → `allReports` → all renders. `injectTestData()` always runs (offline + Supabase) for dev.
- **Test mode**: `?testdata=true` in URL (or supabase=null) injects 48 test reports for 17 venues (incl. queue sessions for live/full states).
- **Font**: Plus Jakarta Sans (Google Fonts) — sans-serif. CSS var: `--font-base: 'Plus Jakarta Sans', sans-serif`.
- **Map**: Mapbox GL JS v3.9.4, style `streets-v12`, center Stockholm `[18.0686, 59.3293]`.

## Product thinking (applies to all tasks)

QueueBar is a real-time decision tool used at 23:00, in low light, under social pressure. Apply the precision and honesty of fintech product discipline to the specific constraints of that context. Do not make it look like a banking app.

Act as an independent product designer. Challenge weak suggestions, form your own opinion, fix the right thing. Load **`/fintech-product-thinking`** for the full operating framework.

Core obligations:
- Every number on screen comes from real data — never a placeholder or fabricated default
- Communicate uncertainty honestly: "~15 min" not "15 min", stale data must be visually degraded
- The most important information (queue status, wait time) always has the most visual weight
- Design for readability at arm's length in low ambient light — minimum 13px body, high contrast
- States must be complete: empty, stale, error — never hide the absence of data
- Challenge redundancy before adding anything new
- Verify with `?testdata=true` before declaring work complete

These apply whether the task is a feature, a bug fix, a spacing change, or a refactor.

## Design principles (non-negotiable)

1. **DATA FÖRST** — real numbers, never placeholders or lorem ipsum
2. **HIERARKI I ALLT** — most important info gets most visual weight
3. **SIFFROR ÄR KUNG** — metrics in 22px+/700, labels in 10-12px
4. **KONSISTENS** — match existing patterns before inventing new ones
5. **REDUNDANS ÄR FÖRBJUDEN** — if two elements show the same info, remove one
6. **BORDER INTE SKUGGA** — dark system uses `1px solid rgba(255,255,255,0.09)` on surfaces, `border-color` for hover states, no box-shadow on cards. See `/premium-design` for full design system values.

## Color system (status)

| Status  | Hero color | Left bar   |
|---------|------------|------------|
| long    | #FF3B3B    | #EF4444    |
| medium  | #FF7043    | #F59E0B    |
| short   | #FFB300    | #F59E0B    |
| free    | #00E676    | #22C55E    |
| empty   | #D1D5DB    | rgba(255,255,255,0.08) |

Full status color system and dark-palette values: `/premium-design`.

## Key CSS classes

- `.erow` — venue row in Utforska (explore list)
- `.erow--empty` — no-data state (0.55 opacity, #FAFAFA bg)
- `.erow--long/--free` — level backgrounds
- `.erow-pulse-dot` — blinking 6px red dot for long queue
- `.exsum` — "Stockholm just nu" summary widget
- `.venue-group` — grouped container with `1px solid rgba(255,255,255,0.09)` border

## Key JS globals

- `VENUES` — array of 27 venue objects `{id, name, address, area, type, lat, lng, closing}`
- `allReports` — live + test reports merged
- `computeStatus(venueId, reports)` — returns status string
- `getStatusClass(status)` — maps to CSS class
- `STATUS_COLORS` — `{free, short, medium, long, unknown}` → hex
- `renderExploreVenues()` — re-renders the explore list + summary widget
- `renderExploreSummary(animate)` — updates "Stockholm just nu" widget
- `injectTestData()` — 48 test reports for 17 venues
- `estimateWait(venueId, reports)` — wait = people ahead ÷ queue rate (measured sessions blended with `venue.pace` prior)
- `formatWait(est)` / `venueWaitText(venueId)` — the only source of wait text on every screen

## Engineering philosophy

QueueBar is a real-time information system, not merely a map app. The hardest problem is turning unreliable human reports into trustworthy, honest information. Every architectural decision should support that.

Core principles:
- **Understand before changing** — trace data flows, read existing code, run check.js first
- **Simplest reliable solution** — prefer explainable deterministic algorithms over clever abstractions
- **Verified, not assumed** — distinguish what you have tested from what you believe to be true
- **Security is layered** — client validation is UX; server-side RLS is the actual boundary
- **Uncertainty is honest** — stale data must look stale; missing data must say so; never invent
- **Evidence over intuition** — observe behavior, form a hypothesis, make the minimal change, inspect the result

Load **`/first-principles-engineering`** for the complete methodology: queue-report lifecycle, freshness model, security layers, search architecture, hypothesis-driven debugging, and the repeatable inspect→diagnose→implement→verify workflow.

Scale depth to risk: a CSS tweak does not need a full audit. An aggregation change or security fix does.

## Security constraints

**NEVER commit `.env`** — already in `.gitignore`. Mapbox token in HTML is public-safe (URL-restricted).

## Commit convention

```
Short imperative title

Body explaining what and why (not how).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MPy84B9aXUBmuBJs5cHVmD
```

## AI checklist (run before every commit)

```bash
node scripts/check.js
```

All checks must pass. If a check fails, fix it before committing.

## Patterns learned from past sessions

- `animation-fill-mode: forwards` is required for keyframe animations that set final state
- `@keyframes rowInEmpty` encodes `opacity: 0.55` in the `to` state — never set opacity directly on `.erow--empty`
- Empty cards MUST sort last — always use `localeCompare(b.name, 'sv')` for Swedish alphabetical
- `STATUS_RANK` map: `{free: 0, none: 0, short: 1, medium: 2, long: 3}` — use for trend calculation
- `computeExploreSummary()` uses 30-min staleness cutoff and 2-hour lookback window
- `_exsumFirstRender` flag controls countUp animation — only animates on first render, not re-renders
- Pulse animation: remove class → force reflow (`void el.offsetWidth`) → re-add class
- Wait time is never a fixed string per status — always `venueWaitText()`; `getStatusLabel()` is only the fallback for reports without `people_ahead`
- Only `report_type: 'initial'` reports measure queue length (`isQueueReport`); followups are positions in the queue, used only for rate
- "Fullt" requires ≥2 measured sessions — never infer it from the pace prior
- Queue session lives in localStorage `qb_queue_session`; `#omw-banner` shows it before "På väg". Followups need ≥4 min gap (server: 3) — never count them as reports or points
- `.toast` text must use `var(--bg-primary)` — background is `--text-primary` (white)
- "På väg" persists in localStorage `qb_on_my_way`; after arrival `#omw-banner` asks for a report for 30 min, then clears. A started queue session always replaces it
- "På väg" counts come from Supabase RPC `on_my_way_counts()` (≥3 only, server-side); the client also hides <3. Table `on_my_way` has RLS with no policies — only the security-definer RPCs touch it
- `forecastWait()` only shows with ≥3 initial reports in 30 min spanning ≥10 min — otherwise the banner falls back to "kön nu"
- Rate layers in `estimateWait`: tonight's sessions → `_historicalRates` (same weekday ±1h, ≥3 sessions, tonight excluded) → `venue.pace`. All non-live sources show "uppskattning"
- `qbCalibration()` in the console: median error, bias (+ = app promised too short) and % inside the shown range, replayed from "Jag är inne" sessions
