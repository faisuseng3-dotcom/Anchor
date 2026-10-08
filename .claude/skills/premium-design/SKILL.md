# /premium-design

Elevate a component or screen to fintech-quality premium design. Use after functional work is done.

## Trigger

`/premium-design [target: component or screen]`

## What "premium" means for QueueBar

Not: gradients, glassmorphism, big animations, drop shadows everywhere.

Yes:
- Every number has a clear unit and context
- Typography has tight tracking on large weights (letter-spacing: -0.02em to -0.04em on 16px+)
- Spacing follows a rhythm (4px grid: 4, 8, 12, 16, 20, 24, 32)
- Colors are exact — no approximations
- States are complete: empty, loading, stale, error
- Transitions communicate state change, not decoration
- Information hierarchy is unambiguous at a glance
- Labels are uppercase + tracked for secondary info (10px/700/0.04em)

## The premium checklist

### Typography

- [ ] Hero numbers: Zilla Slab 22px+/700, letter-spacing -0.02em to -0.04em
- [ ] Section labels: 10px/700, uppercase, letter-spacing 0.04em, #6B7280
- [ ] Body text: 13-14px/400, #6B7280 or #9CA3AF
- [ ] Venue names: 16px/700, #1A1F36, letter-spacing -0.02em
- [ ] Consistent line-height: 1 for numbers, 1.25 for names, 1.45 for meta

### Color precision

- [ ] Status colors only from STATUS_COLORS — not approximated hex
- [ ] `#1A1F36` for primary text (not #000 or #111)
- [ ] `#6B7280` for secondary labels
- [ ] `#9CA3AF` for tertiary/meta
- [ ] `#E5E7EB` for borders
- [ ] `#F3F4F6` for separators and skeleton backgrounds

### Spacing

Inspect padding/gap values. Flag anything not on the 4px grid:
```bash
grep -n "padding:\|gap:\|margin:" index.html | grep -v "calc\|env\|safe" | grep -Ev "[048]px|1[26]px|2[04]px|3[26]px"
```

### Left bar / status indicator

- [ ] 3px width exactly
- [ ] Color matches STATUS_COLORS[cls] — not a separate variable
- [ ] Empty state: `#F0F0F0` (barely visible — pushed back)
- [ ] Stale state: opacity 0.4 via `.erow--stale .erow-left-bar`

### Number formatting

- [ ] Wait times: `~0 min`, `~15 min`, `~25 min`, `30+ min` (not "0 min" or "30 min")
- [ ] Timestamps: `HH:MM` format via `formatAbsTime()`
- [ ] Report counts: `1 rapport` / `N rapporter` (Swedish pluralisation)
- [ ] All numeric values use `font-variant-numeric: tabular-nums` where they update live

### Micro-interactions

- [ ] State transitions animate the thing that changed, not the container
- [ ] countUp only on first render, not re-renders
- [ ] Pulse on changed metric, not on every render
- [ ] Hover on rows: subtle `translateY(-1px)` + light shadow, 150ms
- [ ] Active/press: `scale(0.99)`, 80ms

### Completeness of states

For every component being audited:
| State    | Handled? | How? |
|----------|----------|------|
| Loading  | ?        | skeleton with shimmer |
| Empty    | ?        | message + CTA |
| Data     | ?        | full render |
| Stale    | ?        | dimmed + age shown |
| Error    | ?        | message + retry |

## Output format

```
## Premium Design Audit — [target] — [date]

### Changes that would most improve quality
1. [change]: [current state] → [target state] — [why it matters]
2. ...

### Already premium
- [element]: [what it does well]
```

Implement only after confirming scope with user.
