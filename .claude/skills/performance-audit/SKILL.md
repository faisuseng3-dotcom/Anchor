# /performance-audit

Audit for performance problems. QueueBar runs in a browser at a noisy bar — users are on 4G, impatient.

## Trigger

`/performance-audit`

## Automated checks

```bash
# File size
wc -c index.html
# Target: < 200KB uncompressed. Warning: > 300KB.

# Count render function calls that do allReports.filter() inside a loop
grep -n "allReports\.filter\|allReports\.some\|allReports\.forEach" index.html
# Any inside a map() or forEach() call is O(n²) — flag it

# Count setInterval calls
grep -n "setInterval" index.html
# Each should be cleared on screen change. Verify clearInterval exists for each.

# Count event listeners added inside render functions
grep -n "addEventListener" index.html
# Listeners added inside render functions (called repeatedly) leak. Flag them.

# CDN dependencies and their sizes
grep -n "<script src=\|<link rel=\"stylesheet\"" index.html
```

## Manual checklist

### Data loading

- [ ] `loadReports()` called only when needed — not on every re-render
- [ ] Supabase query uses `.limit(100)` ✓ — does this limit need adjusting?
- [ ] Realtime subscription fires `loadReports()` (full refetch) — acceptable for current scale?
- [ ] `injectTestData()` — does it re-create 52 objects every call? (yes, but it's only called on data load, not per-render)

### Render performance

- [ ] `renderExploreVenues()` — how many DOM operations? Does it replace the whole list innerHTML each call?
- [ ] `renderExploreSummary()` — does it replace and re-create countUp animation on every data refresh?
- [ ] Is there a debounce on the search input? (`debouncedFilterExplore`, 200ms) ✓
- [ ] Is `renderExploreVenues` called on every `allReports` change? How many times per second could it fire?

### Expensive computations

- [ ] `computeExploreSummary()` — iterates `allReports` 3x (venueLatest, freeCount, lastTs). With 100 reports: fine. With 1000: still fine.
- [ ] Sorting in `renderExploreVenues` — calls `allReports.filter()` inside sort comparator = O(n log n × m). With 27 venues and 100 reports: acceptable. Flag for optimization if report count grows.
- [ ] `renderSparkline()` — called per venue row, slices and sorts reports. Watch if venue count grows.

### Animation performance

- [ ] All animations use `transform` and `opacity` only (GPU composited) — not `width`, `height`, `top`, `left`
- [ ] `requestAnimationFrame` used for countUp ✓ — not `setInterval`
- [ ] Sparkline SVG: generated as string and set via innerHTML — not a performance issue at 27 venues

### CDN / network

- [ ] Mapbox GL JS version pinned ✓ (`v3.9.4`)
- [ ] Supabase version pinned ✓ (`@2.45.4`)
- [ ] Google Fonts uses `display=swap` ✓
- [ ] No unversioned CDN URLs (e.g. `@latest`)

```bash
grep -n "cdn\|jsdelivr\|unpkg\|googleapis" index.html | grep -v "@[0-9]"
# Any unversioned CDN URL is a stability risk
```

### Memory

- [ ] `_exsumInterval` cleared when leaving explore screen?
- [ ] Mapbox markers — are old markers removed before adding new ones?
- [ ] Supabase realtime channel — is there only one subscription?

## Output format

```
## Performance Audit — [date]

File size: Xkb

### Critical (causes visible lag)
- ...

### Warning (will matter at scale)
- ...

### Acceptable (note for future)
- ...
```
