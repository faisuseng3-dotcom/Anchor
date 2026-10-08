# /accessibility-audit

Audit for accessibility. QueueBar is a PWA used in noisy, dark environments — a11y is practical, not just compliance.

## Trigger

`/accessibility-audit [screen?]`

## Automated checks

```bash
# Interactive elements without accessible labels
grep -n "onclick=" index.html | grep -v "aria-label\|aria-labelledby\|title=" | head -20

# Images without alt text
grep -n "<img" index.html | grep -v "alt="

# Buttons without text or aria-label
grep -n "<button" index.html | grep -v "aria-label\|aria-pressed\|>[A-Za-z]"

# Color used as only differentiator (look for elements where status is conveyed only via color)
grep -n "class.*erow-left-bar\|class.*erow-hero" index.html | head -10
# Manual: verify status is also communicated via text, not just color
```

## Manual checklist

### Tap targets (critical for bar environment — dark, loud, drunk users)
- [ ] All interactive elements ≥44×44px
- [ ] Filter buttons (`.fbtn`): check actual rendered height
- [ ] Venue rows (`.erow`): `min-height: 80px` ✓
- [ ] Bottom nav buttons: check padding
- [ ] "Rapportera" submit buttons inside venue card

### Color contrast
- [ ] Text on white background (#FFFFFF): body text #1A1F36 ≥ 7:1 ✓
- [ ] Secondary text #6B7280 on #FFFFFF: ~4.6:1 (AA borderline)
- [ ] Status colors on tinted backgrounds:
  - `#DC2626` on `rgba(239,68,68,0.04)` — check contrast
  - `#16A34A` on `rgba(34,197,94,0.03)` — check contrast
- [ ] Pulse dot (#EF4444) on #FAFAFA: contrast sufficient?

### Status communicated without color alone
- [ ] Trend indicators use text (↑ Ökar / ↓ Minskar / → Stabil) ✓
- [ ] Hero text shows time estimate, not just color ✓
- [ ] Status badge removed from explore cards — does any color-only element remain?

### Focus management
- [ ] Does the venue card sheet trap focus when open?
- [ ] Can the sheet be dismissed with keyboard (Escape)?
- [ ] Is there a visible focus ring on buttons?

### Screen reader
- [ ] `lang="sv"` on `<html>` ✓
- [ ] Live region for real-time updates? (`aria-live="polite"` on feed?)
- [ ] Venue card: is the status information announced when the card opens?

### Motion sensitivity
- [ ] `@media (prefers-reduced-motion: reduce)` disables animations ✓
- [ ] Pulse dot stops pulsing under `prefers-reduced-motion`?

```bash
grep -n "prefers-reduced-motion" index.html
# Verify pulse-dot animation is also inside this media query
grep -A5 "prefers-reduced-motion" index.html | grep "pulseDot\|pulse-dot"
```

### Language and copy
- [ ] All UI copy is Swedish (matches `lang="sv"`)
- [ ] Error messages are actionable ("Försök igen" not "Error 500")
- [ ] Empty states give context ("Inga rapporter än — bli först")

## Output format

```
## Accessibility Audit — [screen] — [date]

### Critical (WCAG AA failure)
- ...

### Important (poor UX in use context)
- ...

### Minor
- ...

### Passing
- ...
```
