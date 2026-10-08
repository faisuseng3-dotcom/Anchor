# /responsive-audit

Audit for mobile-first layout correctness. QueueBar is a PWA — mobile is the primary surface.

## Trigger

`/responsive-audit [screen?]`

## Context

- App is fullscreen mobile PWA: `width=device-width, viewport-fit=cover`
- Bottom nav takes ~56px + `env(safe-area-inset-bottom)`
- Top status bar: `env(safe-area-inset-top)`
- Screens use `overflow-y: auto` with `padding-bottom: calc(80px + env(safe-area-inset-bottom))`
- No desktop breakpoints currently — single layout that must work 375px–430px

## Checklist

### Safe area handling
- [ ] Top padding uses `env(safe-area-inset-top)` where content reaches the notch
- [ ] Bottom padding uses `env(safe-area-inset-bottom)` on scrollable containers
- [ ] Fixed/sticky elements account for safe areas
- [ ] `.explore-sticky` top: `calc(16px + env(safe-area-inset-top))`

### Text overflow
- [ ] All `.erow-name` elements have `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
- [ ] Hero numbers (`~30+ min`) don't overflow their container at any font scale
- [ ] `.exsum-num` (22px) fits in its flex cell at 375px
- [ ] Labels don't wrap unexpectedly

### Tap targets
- [ ] All interactive elements are ≥44px tall (iOS HIG minimum)
- [ ] Filter buttons (`.fbtn`) — check min height
- [ ] Venue rows (`.erow`) — `min-height: 80px` ✓ already enforced

### Overflow
- [ ] No horizontal scroll on any screen
- [ ] `overflow-x: hidden` on main containers
- [ ] Flex children use `min-width: 0` where needed to allow shrinking
- [ ] `.erow-body` and `.erow-right` don't overflow their parent

### The notch/island area (iPhone 14+)
- [ ] Map pin overlay `.map-pill` clears the dynamic island
- [ ] Venue card sheet clears the home indicator

### Viewport meta
- [ ] `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- [ ] No `user-scalable=no` (accessibility violation)

### Font scaling
- [ ] Layout still works when user has large text enabled (test at 200% browser zoom mentally)
- [ ] No `px` heights on text containers that would clip at large sizes

## How to audit without a device

Search for potential issues:
```bash
grep -n "min-width: 0" index.html         # should appear on flex children with text
grep -n "overflow: hidden" index.html      # text containers
grep -n "safe-area" index.html             # safe area usage
grep -n "white-space: nowrap" index.html   # ellipsis candidates
```

## Output format

```
## Responsive Audit — [screen] — [date]

### Failing
- [issue]: [line/class] — [impact]

### Warnings (likely fine but verify on device)
- ...

### Passing
- ...
```
