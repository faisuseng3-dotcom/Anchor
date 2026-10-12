# /anti-ai-design

Detect and remove generic AI-generated design patterns. QueueBar must feel like a deliberate product, not an AI component demo.

This skill is a detection and removal tool. For the full quality standard (what "good" looks like), load `/premium-design`.

## Trigger

`/anti-ai-design [screen?]`

---

## Pattern catalogue

### Decorative shadows (replace with border-color)

Cards, rows, and list containers should use `border-color` for hover/active feedback — not `box-shadow`. Shadows imply depth and permanence; this product is live and changing.

**Exception**: map overlays, floating action buttons, and bottom sheets emerging from the edge of the screen may keep shadows (they need the depth cue to separate from content behind them).

```bash
grep -n "box-shadow" index.html | grep -v "map\|fab\|sheet\|ripple\|conf-bar\|focus\|0 0 0\|inset"
```

Any result on `.erow`, `.vcrow`, `.vcard`, or inline card containers is a removal candidate.

---

### Gradient backgrounds on UI surfaces

Gradients do not communicate state. Only the Mapbox map, SVG sparklines, and the background orbs (intentional atmospheric effect) use them.

```bash
grep -n "linear-gradient\|radial-gradient" index.html | grep -v "svg\|map\|bg-orb\|orbFloat"
```

---

### Excessive border-radius

`--radius-md` (8px) for content cards, `--radius-lg` (12px) for sheets and groups, `--radius-full` for pills. Values above 16px on rectangular cards are a decoration signal.

```bash
grep -n "border-radius: [2-9][0-9]" index.html | grep -v "radius-xl\|radius-full\|50%\|sheet\|consent\|onboarding"
```

---

### Glassmorphism — justified vs. unjustified

`backdrop-filter: blur(...)` is intentionally used on:
- `.erow` (explore rows) — separates them from the dark bg during scroll
- `.live-row` — same reason
- `.map-search-float` — floats over the map
- `.explore-sticky` — sticky header needs separation from scroll content

Flag new uses. Before adding `backdrop-filter`, answer: does this element sit in front of content that scrolls or changes behind it? If not, remove it.

```bash
grep -n "backdrop-filter" index.html
```

---

### Font weight inflation

Hero queue times (28px, `.erow-hero`, `.live-wait`) use `font-weight: 900` — this is intentional. The weight communicates urgency from real data and must dominate at a glance.

Flag 900 weight on anything that is not a hero metric:

```bash
grep -n "font-weight: 900\|font-weight:900" index.html | grep -v "erow-hero\|live-wait\|rs-name\|live-name"
```

---

### Status colors used decoratively

Green, amber, and red carry exact meaning in QueueBar: free, short/medium, long queue. Using them outside of status contexts dilutes the signal.

Check for green or red in non-status contexts:
```bash
grep -n "#22C55E\|#00E676\|#EF4444\|#FF3B3B\|#DC2626" index.html | grep -v "STATUS_COLORS\|status-free\|status-long\|success\|danger\|pulse-dot\|live-dot\|bast-dot"
```

Any result that is decorative (not communicating queue status or a system alert) should be replaced with a neutral color.

---

### Fake or placeholder metrics

Every number on screen must come from `allReports`, `VENUES`, Supabase, or a deterministic calculation. Never a static default that implies real data.

```bash
grep -n '"4\.[0-9]\|★\|visits\|check-in' index.html
```

---

### Animations on every render

Animate state changes — not component presence. An animation that fires every time `renderExploreVenues()` runs adds noise without information.

Rules:
- `breatheRed` on `.erow--long` — justified (communicates active urgency)
- `ripplePulse` on `.erow-pulse-dot` — justified (fresh long-queue report)
- `livePulse` on `#live-dot` — justified (live indicator)
- Card stagger on first screen load — justified (orients the user to new content)
- Hover `transform: translateY(...)` on rows — remove if it exceeds 1–2px; it communicates nothing

```bash
grep -n "animation:\|@keyframes" index.html | wc -l
```

If the count grows above 20 distinct keyframes, audit which ones fire on state change vs. on every render.

---

### Decorative icons

Every icon should answer exactly one of:
- What action does this trigger?
- What status does this communicate?

Icons that answer "this looks like a professional app" are decoration. Review any icon that cannot be described with a verb or a status noun.

---

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

When a new AI-design anti-pattern is discovered, add it to this file so it gets caught next time.
