# /premium-design

Define and evaluate production-quality design for QueueBar. Load before implementing any UI component, running a visual audit, or deciding whether a design decision is correct.

## Trigger

`/premium-design [target]` — or auto-load whenever a design decision requires judgment rather than just mechanical execution.

---

## What quality means for QueueBar

QueueBar is used at 23:00 on a Friday, in low light, while moving, under mild social pressure, with 20 minutes to decide where to go. Quality means the interface serves that person — not that it looks good in a screenshot.

Premium is not a visual style. It is the result of every element earning its place through precision, honesty, and usefulness. The UI should feel alive when activity is high and calm when nothing requires attention.

**Not premium**: gradients that don't communicate anything, blur effects applied universally, animations on every render, neon accents that erode the meaning of status colors, cards nested inside cards.

**Premium**: a queue time that is instantly readable at arm's length. A stale report that looks stale. A free venue that feels different from a venue with no data. Nothing on screen that doesn't help the user decide.

---

## QueueBar design system (verified values)

**Font**: `'Plus Jakarta Sans'` — CSS var `--font-base`. Do not reference Zilla Slab; the codebase migrated away from it.

**Dark palette:**
```
--bg-primary:    #08090F   (app background)
--bg-secondary:  #0D0F1A   (elevated surfaces, sheets)
--surface:       rgba(255,255,255,0.045)
--surface-hover: rgba(255,255,255,0.07)
--border:        rgba(255,255,255,0.09)
--border-hover:  rgba(255,255,255,0.16)
--border-focus:  rgba(59,130,246,0.50)
--text-primary:  #FFFFFF
--text-secondary:#9CA3AF
--text-muted:    #6B7280
--accent:        #3B82F6
--danger:        #EF4444
--success:       #22C55E
```

**Status colors (use STATUS_COLORS, never ad-hoc hex):**
```
free:    #22C55E   (hero: #00E676)
short:   #F59E0B   (hero: #FFB300)
medium:  #EA7300   (hero: #FF7043)
long:    #EF4444   (hero: #FF3B3B)
unknown: #D1D5DB
```

**Type scale:**
```
Hero queue time:  28px / 900 / letter-spacing -0.02em / tabular-nums
Venue name:       14-16px / 700 / letter-spacing -0.01em to -0.02em
Screen title:     24px / 700 / letter-spacing -0.03em
Section label:    12px / 700 / uppercase / letter-spacing 0.04em / --text-muted
Meta / tertiary:  12-13px / 400 / --text-secondary or --text-muted
Body:             14px / 400 / line-height 1.45
```

**Spacing (8px grid with 4px steps):** 4, 8, 12, 16, 20, 24, 32. CSS vars: `--space-1` (8px) through `--space-6`. Anything not on this grid needs a justification.

---

## 9-dimension evaluation framework

Use this when implementing a component, auditing a screen, or deciding between two approaches. Work through the dimensions in order — functional defects (1–3) before aesthetic refinements (4–9).

### 1. Layout correctness and overflow

- Does the layout hold when data is longer than the test case? (venue names up to ~25 chars, wait times as "30+ min")
- Are `white-space: nowrap` and `text-overflow: ellipsis` applied where text can overflow?
- Does nothing clip, overlap, or break at 375px viewport width?
- Are fixed heights only used where content is genuinely fixed?

### 2. Information hierarchy

- What is the single most important fact on this component? Is it visually dominant?
- Can the user answer the component's core question (status? wait time? name?) in under 2 seconds without reading?
- Are labels visually subordinate to values? A label should never compete with the data it describes.
- Is there a competing element at the same visual weight as the hero? If yes, one of them is wrong.

### 3. Typography and numerical alignment

- Queue times and counts that update live: `font-variant-numeric: tabular-nums` to prevent layout shift
- Large weights (16px+): `letter-spacing: -0.01em` to `-0.03em` — tighter tracking reads better at weight
- Status text: hedged language where uncertainty exists ("Verkar kort kö", not "Kort kö"; "Fri" not "0 min")
- Do not use uppercase on every label — reserve it for genuine section headers (12px/700/0.04em)
- Do not use monospace for every number — use `tabular-nums` on the font-feature instead

### 4. Color discipline

- Every color on screen: does it come from the design system above, or is it ad-hoc?
- Status colors (green/amber/red) must not appear for non-status purposes — they carry meaning and diluting that meaning erodes trust
- Accent blue (`--accent`) is for interactive states and progress, not decoration
- Does the design work in the dark environment QueueBar is used in? Contrast must hold at arm's length in low ambient light
- Stale or uncertain data must look visually degraded — dimmed, not hidden

### 5. Spacing and information density

- Is there consistent rhythm between elements? Check against the 8px grid
- Is any whitespace purely decorative, taking space away from useful information?
- Is any card so sparse it would be denser as a row?
- Is the most urgent information closest to the user's first glance (top-left or top of hierarchy)?

### 6. Component consistency

- Does this component look and behave like its peers? (all venue rows, all status indicators, all filter chips)
- Are CSS variables used for color and spacing, or are values hardcoded inline?
- If a pattern exists elsewhere in the file, reuse it rather than inventing a new one

### 7. Interaction states and accessibility

- Default, hover, active, selected, disabled: are all relevant states defined and visually distinct?
- Touch targets: minimum 44×44px for tappable elements in the main flow; 32px acceptable for secondary icon buttons
- Focus-visible state: does keyboard navigation show a clear indicator?
- Does status depend on color alone? Every status must also communicate through text or shape

### 8. Responsive behavior

- Does the component hold at 375px (minimum supported width)?
- Does dynamic data (long names, large numbers, many items) break the layout or clip?
- Are bottom-sheet and overlay z-indices consistent with the stack (`--z-map: 1`, `--z-sheet: 5`, `--z-modal: 20`, `--z-overlay: 30`)?

### 9. Purpose test

Before adding or keeping any element, answer: does this help the user make a faster or better decision?

If the answer is "it looks good" or "it fills the space" or "other apps do this" — remove it.

---

## QueueBar-specific standards

These apply in addition to the 9-dimension framework and take precedence when they conflict.

**Scan speed** — a user should identify the three worst queues in the explore list in under 5 seconds without tapping. If they cannot, the hierarchy is wrong.

**Freshness honesty** — data older than 45 minutes must appear visually degraded. Use `.erow--stale` (opacity 0.4 on bar and hero). Never show stale data at full weight.

**No color-only status** — every queue status must communicate through both color AND text/label. A user who cannot distinguish red from amber (color blindness, low light, worn screen) must still understand the status.

**Live energy from data** — the pulse dot on a long queue is justified: it communicates urgency from real data. An animation applied to a venue with no activity communicates nothing and is noise.

**Free vs. no data** — "Fri" and "–" are not the same state and must not look the same. Free means someone reported no queue. Empty means we have no information. Treat them differently.

**Report freshness is the most important metadata** — the time since the last report matters more than the number of reports. Design must prioritize freshness over count.

---

## Independent judgment

These are principles, not commands. The correct implementation depends on context.

Do not mechanically:
- Set every border to `rgba(255,255,255,0.09)` when a different value serves the hierarchy better
- Apply `backdrop-filter` to every floating element because it "looks premium"
- Set every number to 900 weight — hero numbers use 900 because they must dominate; secondary numbers do not
- Add `letter-spacing: -0.02em` to every text element regardless of size

When a rule would reduce readability, accessibility, or usability in the specific context, say so and explain why. The goal is a product that works for a person at 23:00 in the dark — not a product that satisfies a style guide.

When a non-standard approach genuinely serves that goal better, use it and document why.

---

## Relationship to other skills

| Skill | Role |
|---|---|
| `/premium-design` | This file — defines what quality looks like; the standard to evaluate against |
| `/ui-audit` | How to run a structured per-screen audit; uses this file as its quality reference |
| `/anti-ai-design` | Detection of specific anti-patterns; grep-based removal tool |
| `/fintech-product-thinking` | Product philosophy — what to show, when, and why |
| `/first-principles-engineering` | Data integrity and architecture — correctness before aesthetics |
