# /ui-audit

Audit the current UI for quality problems. Do not fix during audit — produce a prioritised finding list first, then ask which to fix.

## Trigger

`/ui-audit` or `ui-audit [target]` where target is a screen name (explore, home, live, profile) or "all".

## Process

### 1. Identify scope
If target is a screen: grep for `#screen-{target}` and read the relevant section.
If "all": audit all four screens plus shared components.

### 2. Run the automated check first
```bash
node scripts/check.js
```
Any failing check is automatically a P0 finding.

### 3. Audit against these lenses (in order)

**HIERARCHY**
- Does the most important information have the most visual weight?
- Is there a clear dominant element per card/row?
- Are labels significantly smaller than values? (values 18px+, labels ≤12px)
- Are there competing elements at the same weight?

**REDUNDANCY** (project principle 5)
- Does any element show the same data as another element on the same card?
- If yes: which one has less information value? Mark it for removal.

**INFORMATION DENSITY**
- Is there dead whitespace where data could live?
- Are there elements that exist for decoration rather than information?
- Count UI elements per card. Justify each one.

**CONSISTENCY**
- Do similar things look the same? (all venue rows, all status badges, all hero numbers)
- Are CSS variables used for color/spacing, or are values hardcoded?
- Check STATUS_COLORS is used — not ad-hoc hex values for status indicators.

**EMPTY / LOADING / ERROR STATES**
- What does each section look like with zero data?
- Is there a skeleton/loading state or a blank flash?
- Is there an actionable error state?

**VISUAL NOISE**
- Are there shadows where borders would be cleaner? (project: border not shadow)
- Are there gradients with no purpose?
- Are there animations that fire on every render rather than only on state change?
- Are there more than 2 font weights in a single component?

### 4. Output format

```
## UI Audit — [screen] — [date]

### P0 — Broken / data incorrect
- [finding]: [location in file, line number if known]

### P1 — Hierarchy / redundancy problem  
- [finding]: [why it violates which principle]

### P2 — Visual inconsistency
- [finding]: [what it should match]

### P3 — Polish / minor
- [finding]: [low-effort improvement]

### Clean
- [what is working well — do not change]
```

### 5. After presenting findings
Ask: "Which findings should I fix? (P0 auto-fix, or specify P1/P2/P3)"

Fix P0s immediately without asking.

For each fix: run `node scripts/check.js` and verify no regressions.
