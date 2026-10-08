# /anti-ai-design

Remove generic AI-generated design patterns. QueueBar should feel like a deliberate fintech product, not an AI component demo.

## Trigger

`/anti-ai-design [screen?]`

## What to hunt for and remove

### Decorative shadows (replace with borders)
Pattern: `box-shadow` on cards, rows, or containers where a `border` would be cleaner.
**QueueBar rule**: cards use `1px solid #E5E7EB`, not shadows.

Exception: map overlays and floating action buttons may keep shadows.

```bash
grep -n "box-shadow" index.html | grep -v "map\|fab\|hover\|focus\|0 0 0"
```
Any result touching a `.venue-group`, `.erow`, `.exsum`, or card container is a candidate for removal.

### Gradient backgrounds
Pattern: `background: linear-gradient(...)` on UI surfaces.
**Rule**: flat colors only. Gradients only allowed inside SVG sparklines or explicit map overlays.

```bash
grep -n "linear-gradient\|radial-gradient" index.html | grep -v "svg\|map"
```

### Excessive border-radius
Pattern: `border-radius: 16px` or higher on rectangular content cards.
**Rule**: `--radius-md` (8px) for cards, `--radius-full` (9999px) for pills only.

```bash
grep -n "border-radius: [2-9][0-9]" index.html
```

### Glassmorphism
Pattern: `backdrop-filter: blur(...)` combined with semi-transparent backgrounds.
Acceptable only on the map overlay pill (`.map-pill`).

### Decorative icons without function
Pattern: icons that decorate rather than clarify action or status.
Every icon should answer: what does the user do with or learn from this?

### Fake metrics / meaningless numbers
Pattern: stats that don't come from real data (e.g. "4.8 ★", "2.3k visits").
**Rule**: every number in the UI must come from `allReports`, `VENUES`, Supabase, or deterministic calculation. Never a static placeholder.

### Excessive animation
Pattern: animations on every interaction, `transition` on properties that don't need it.
**Rule**: animate only state changes. Don't animate properties that don't communicate state.

```bash
grep -n "transition:" index.html | wc -l
```
If > 20, review each one.

### Font weight inflation
Pattern: more than 2 weights in a single component, or using 900 weight for "impact".
**QueueBar weights**: 400 (body), 600 (emphasis), 700 (hero/label). No 800/900.

### Color without meaning
Pattern: accent colors used decoratively rather than to communicate status/state.
**QueueBar rule**: green = free, amber = short/medium, red = long, gray = empty/unknown. These colors must not appear for any other reason.

## Output format

```
## Anti-AI Design Audit — [screen] — [date]

### Remove immediately
- [element]: [why it's decorative / what to replace with]

### Simplify
- [element]: [current → better]

### Keep (intentional)
- [element]: [why it's justified]
```

## After fixing
Run `node scripts/check.js` — no regressions.
Add new pattern to this file if a new AI-design anti-pattern is discovered.
