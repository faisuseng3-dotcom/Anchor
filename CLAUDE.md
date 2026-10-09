# QueueBar — Claude Project Memory

## What this project is

Single-file web app (`index.html`) for real-time queue status at Stockholm bars and clubs.
Vanilla JS + CSS, no framework, no build step. Mapbox GL JS + Supabase via CDN.
Deployed on Vercel. Branch: `claude/queuebar-expo-setup-do34fo` → merge to `main` for deploy.

## Architecture

- **One file**: all HTML, CSS, JS in `index.html`. Never split into separate files without asking.
- **Screens**: `#screen-home` (map), `#screen-explore` (list), `#screen-live` (feed), `#screen-profile`
- **Data flow**: `loadReports()` → `allReports` → all renders. `injectTestData()` always runs (offline + Supabase) for dev.
- **Test mode**: `?testdata=true` in URL (or supabase=null) injects 52 test reports for 17 venues.
- **Font**: Zilla Slab (Google Fonts) — serif. CSS var: `--font-base: 'Zilla Slab', Georgia, serif`.
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
6. **BORDER INTE SKUGGA** — fintech aesthetic: `1px solid #E5E7EB`, no box-shadow on cards

## Color system (status)

| Status  | Background tint           | Hero color | Left bar   |
|---------|--------------------------|------------|------------|
| long    | rgba(239,68,68,0.04)     | #DC2626    | #EF4444    |
| medium  | #FFFFFF                  | #D97706    | #F59E0B    |
| short   | #FFFFFF                  | #D97706    | #F59E0B    |
| free    | rgba(34,197,94,0.03)     | #16A34A    | #22C55E    |
| empty   | #FAFAFA, opacity 0.55    | #D1D5DB    | #F0F0F0    |

## Key CSS classes

- `.erow` — venue row in Utforska (explore list)
- `.erow--empty` — no-data state (0.55 opacity, #FAFAFA bg)
- `.erow--long/--free` — level backgrounds
- `.erow-pulse-dot` — blinking 6px red dot for long queue
- `.exsum` — "Stockholm just nu" summary widget
- `.venue-group` — white card container with border

## Key JS globals

- `VENUES` — array of 27 venue objects `{id, name, address, area, type, lat, lng, closing}`
- `allReports` — live + test reports merged
- `computeStatus(venueId, reports)` — returns status string
- `getStatusClass(status)` — maps to CSS class
- `STATUS_COLORS` — `{free, short, medium, long, unknown}` → hex
- `renderExploreVenues()` — re-renders the explore list + summary widget
- `renderExploreSummary(animate)` — updates "Stockholm just nu" widget
- `injectTestData()` — 52 test reports for 17 venues

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
