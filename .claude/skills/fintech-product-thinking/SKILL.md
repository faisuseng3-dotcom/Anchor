# /fintech-product-thinking

QueueBar product philosophy. Load before any UI/UX task, feature design, or screen-level decision.

## Trigger

Auto-load for: product design, screen layout, UI component, information hierarchy, interaction design, empty/loading/error states, navigation, reporting flow. Also invoke explicitly with `/fintech-product-thinking`.

---

## What this product actually is

QueueBar is a **real-time decision tool used in a specific physical and social context**: you are at 23:00 on a Friday, standing outside a bar or deciding where to go in the next 20 minutes. Your phone is in one hand, your friends are asking, and you need an answer in five seconds.

That context shapes every design decision. It is not a banking dashboard reviewed calmly at a desk. It is not a venue discovery app browsed on a Sunday afternoon. It is a tool used in low light, with noise, while moving, under mild social pressure, with real time constraints.

Design for that person. Not for the screenshot, not for the demo.

---

## The core question

Before touching any code: **what does the user need to understand or do right now, and what is standing in the way?**

Not "what would look good here." Not "what do fintech apps usually do here." Those produce imitation. The first question produces product.

---

## Two disciplines, one product

### From fintech, take the discipline

Not the aesthetic. Fintech products are trustworthy because they are precise, predictable, and honest — not because they use a particular color palette or card layout.

What transfers directly to QueueBar:
- **Clear hierarchy**: the most important information is immediately dominant. No hunting.
- **Honest uncertainty**: "~15 min" is correct. "15 min" implies false precision. If you don't know, say so.
- **Complete states**: every component has an empty state, a stale state, and an error state. An app that shows nothing when there is nothing is more trustworthy than one that shows fake activity.
- **Restrained motion**: animate state changes. Never animate for sophistication.
- **Consistent system**: the same status always looks the same, everywhere. One deviation breaks the pattern and breaks trust.
- **No manufactured confidence**: never invent an insight. Every claim must be traceable to real data.

### From the nightlife context, take the constraints

These override fintech conventions where they conflict:
- **Readability in darkness**: type must be legible at arm's length in low ambient light. Minimum 13px body, 16px venue names, high-contrast status colors. No light gray on white.
- **Five-second decisions**: a user should be able to compare three venues and decide without scrolling, zooming, or tapping into detail views.
- **Community data is inherently uncertain**: unlike bank transactions, these are human reports. Freshness matters more than quantity. A single report from 10 minutes ago is more useful than four reports from 90 minutes ago. Design for this.
- **Energy, not calm**: fintech should feel calm. A nightlife app should feel present and alive — but without decorative clutter. The energy comes from the data (real queues are urgent), not from animations or colors applied to non-urgent states.
- **Swedish social context**: area names (Södermalm, Östermalm) are how Stockholmers navigate, not addresses. Closing times matter. Weekend nights are the primary use case.

---

## Operating as an independent designer

Express your design opinion. When the user's suggestion is weak — visually noisy, redundant, hierarchically wrong, misleading — say so and explain why. A yes-person produces mediocre products.

**Decide independently (no approval needed):**
- Typography: size, weight, letter-spacing, line-height
- Spacing on the 4px grid
- Which element is hero vs. secondary
- Whether to remove a redundant element
- Color choices within the established system
- Whether an animation is justified or decorative

**Get approval for:**
- New data sources or fields not already in `allReports` / `VENUES`
- New screens or navigation structure
- Any change to how queue status is computed
- Removing a feature entirely

---

## The five-second test

What does the user understand in five seconds on each screen?

| Screen | The question it must answer immediately |
|--------|----------------------------------------|
| Home (map) | Where are the long queues right now? |
| Explore (list) | Which venues are worth going to tonight? |
| Live (feed) | What is happening across the city right now? |
| Report | How do I submit my observation in under 10 seconds? |
| Profile | (Not a decision screen — keep it minimal) |

If the answer to that question is not immediately visible, the hierarchy is wrong. Fix the hierarchy, not the color.

---

## Information hierarchy

These are product rules:

1. The most important information gets the largest, heaviest, most prominent treatment
2. Labels are always subordinate to values — labels should never compete
3. If two elements communicate the same fact, one is waste — remove it
4. Secondary information supports the primary — it does not compete
5. Meta (timestamps, report counts, area names) belongs at the bottom or right

**Status hierarchy for any QueueBar component (most → least important):**
1. Queue status (free / short / medium / long)
2. Wait time estimate (~X min)
3. Venue name
4. Area / neighborhood
5. Report count and freshness

Any component that inverts this has a hierarchy problem.

---

## Communicating uncertainty and confidence

This is the most important design problem in QueueBar and the least addressed. Community reports are uncertain by nature. Design must communicate that honestly.

**Freshness over quantity**: a single report from 8 minutes ago is more credible than three reports from 80 minutes ago. Freshness should be visually prominent — not hidden in a timestamp footnote.

**Conflicting reports**: if the most recent report says "free" but the three before it said "long", the current display is misleading. The product should surface this tension, not hide it. Options: show a confidence indicator, show the trend direction, or show the most recent report prominently with context.

**Staleness cutoff**: data older than 45 minutes should appear visually degraded — not removed, but dimmed, with a clear age label. Data older than 2 hours should not influence status calculations.

**Language**: use hedged language. "Verkar kort kö" is honest. "Kort kö" implies certainty we don't have. Swedish hedges: "Verkar...", "Troligtvis...", "Senast rapporterat: X min sedan".

**Zero reports**: this is a common state. Show it honestly. "Ingen data" with a muted style is correct. Never infer status from absence.

---

## Venue comparison

The primary use case involves comparing 3–5 nearby venues before deciding. Design must support this:

- Status must be scannable without tapping into detail views
- The most urgent venue (longest queue) should be visually distinct and not require reading
- Area context helps comparison — two venues in the same neighborhood are directly comparable
- Closing time is a comparison factor — a free venue closing in 20 minutes is not attractive

The Explore list is the primary comparison view. It must support fast vertical scanning. Anything that requires horizontal reading or tapping to compare venues is a friction point.

---

## Reporting flow principles

Fast reports = better data = better product. The report flow must be:

- **Maximum 3 taps from any screen** to submit a status report
- **Minimal cognitive load**: present options as spatial/visual choices, not text dropdowns
- **Confidence-proportional options**: "Kön sträcker sig till hörnet" is more useful than "Lång kö" if the UI can surface it
- **Acknowledge submission immediately**: the user needs to know their report was received before they put their phone away
- **Honest about impact**: "Din rapport hjälper andra" is genuine. "You're the first!" when you're not is not.

Spam resistance must be invisible to honest users. It should never add friction for normal use.

---

## When not to add

The instinct to add is almost always wrong. Before adding any element:

- Does this help the user make a decision they couldn't make without it?
- Does this replace something, or stack on top of an already-full screen?
- Is this data real, current, and meaningful — or decorative?
- Would it survive if the underlying data were sparse or zero?

The Explore list currently shows: status bar, venue name, area, wait time, trend indicator, report count, sparkline. That is already dense. Adding more requires removing something first.

---

## Visual language

QueueBar should feel like a product that belongs to the Stockholm nightlife context — not a banking app with venue names, not a generic discovery app, not an AI dashboard.

What that means in practice:
- **Typography**: Zilla Slab gives character without being decorative. Use it as the system font, not as an accent. Weight does the work — not size inflation.
- **Color**: status colors carry meaning. They are not accent colors. Using green or red for decoration outside of status contexts dilutes their signal.
- **Density**: nightlife information is inherently dense. Don't fight it with excessive whitespace — manage it with hierarchy. The goal is clarity at density, not spaciousness at the cost of information.
- **Borders, not shadows**: flat surfaces with `1px solid #E5E7EB`. Depth suggests permanence; this product is live and changing.
- **Motion**: the pulse dot on a long queue is justified — it communicates urgency from real data. An animation on a card hover is not justified — it communicates nothing.

---

## Avoiding generic AI design

The patterns below are defaults — what emerges when there is no design thinking. Challenge before using:

- Repeated card grid with icon + heading + number + description
- Status badge pills where text or left-bar color alone would communicate better
- Skeleton loading screens where a simple empty state is cleaner
- Charts that visualize trends without enabling any action on them
- Insight tiles ("Tonight looks busy!") with no data and no decision value
- Animations on every render rather than on state change
- Excessive rounded containers and nested cards
- Decorative icons that add visual noise without communicating action or status

**QueueBar-specific anti-patterns:** see `/anti-ai-design` for grep-based detection.

---

## Before proposing or building anything

1. Read the relevant section of `index.html` — understand what exists
2. Run `node scripts/check.js` — a failing check blocks all new work
3. Identify what the user needs to decide on this screen
4. Find what is currently wrong — hierarchy, staleness, missing state, inconsistency
5. Form an opinion, then implement the minimum change that fixes it

## After implementing

1. Run `node scripts/check.js` — all checks must pass
2. Verify with `?testdata=true` — check data-present AND empty/stale states
3. Five-second test: is the most important information still dominant?
4. Ask: did this make the product more useful, or just different?

---

## Relationship to other skills

| Skill | Purpose |
|-------|---------|
| `/fintech-product-thinking` | This file — operating philosophy, design judgment |
| `/ui-audit` | Structured per-screen audit, produces P0–P3 findings |
| `/anti-ai-design` | Grep-based removal of decorative patterns |
| `/premium-design` | Typography and spacing precision checklist |

Load this to think. Load the others to audit specific dimensions.
