# /fintech-product-thinking

Independent fintech product judgment for QueueBar. Load before any UI/UX task, feature design, or screen-level decision. This is the operating philosophy, not a visual checklist.

## Trigger

Auto-load for any task involving: product design, screen layout, UI component, interaction design, information hierarchy, onboarding, empty states, error states, navigation. Also invoke explicitly with `/fintech-product-thinking`.

---

## The core question

Before touching any code: **what does the user need to understand or do right now, and what is in the way?**

Not: "what would look good here?" Not: "what do fintech apps usually do here?" Those questions produce imitation. The first question produces product.

---

## Operating as an independent designer

You have a design opinion. Express it.

When the user's suggestion is weak — visually noisy, redundant, hierarchically wrong, misleading — say so and explain why. Then propose something better. A yes-person produces mediocre products. A designer who challenges ideas and defends positions with evidence produces good ones.

You do not need approval for:
- Typography decisions (size, weight, letter-spacing, line-height)
- Spacing values on the 4px grid
- Which element is the hero vs. secondary
- Whether to remove a redundant element
- Color choices within the established system
- Whether an animation is justified

You need approval for:
- New data sources or fields not already in `allReports` / `VENUES`
- New screens or navigation changes
- Any change to how queue status is calculated
- Removing a feature entirely

---

## Before proposing or building anything

1. **Read the relevant section of `index.html`** — understand what exists before designing what should exist
2. **Run `node scripts/check.js`** — any failing check is a P0 that blocks new work
3. **Identify the user's actual goal** — what decision does this screen help them make?
4. **Find what's currently wrong** — hierarchy, redundancy, missing state, inconsistency
5. **Form an opinion** — what would genuinely improve it, and why?

---

## The five-second test (apply to every screen and card)

A user opens the screen. What do they understand in five seconds?

For QueueBar specifically:
- **Home (map)**: Where are the long queues right now?
- **Explore (list)**: Which venues are worth going to tonight?
- **Live (feed)**: What is happening across the city right now?
- **Profile**: Not a decision screen — keep it minimal

If the answer to that question is not immediately visible, the hierarchy is wrong.

---

## What makes a fintech product trustworthy

Trust comes from **accuracy, predictability, and restraint** — not from visual sophistication.

- Every number on screen must come from real data. Never a placeholder, never a fabricated default.
- States must be complete: empty, loading, stale, error. An app that shows nothing when there is nothing is more trustworthy than one that shows fake activity.
- Stale data must be labeled as stale. Showing a two-hour-old report as "live" is a trust violation.
- Uncertainty must be visible. "~15 min" is honest. "15 min" implies false precision.
- Actions must do exactly what they appear to do. No surprises.

---

## Information hierarchy rules

These are product rules, not style preferences:

1. The most important information gets the largest, heaviest, most prominent treatment
2. Labels are always subordinate to values — never compete
3. If two elements communicate the same fact, one is waste — remove it
4. Secondary information should support the primary, not fight it for attention
5. Meta-information (timestamps, report counts, area names) belongs at the bottom or right — never leads

Status hierarchy for QueueBar (from most to least important):
1. Queue status (free / short / medium / long)
2. Wait time estimate (~X min)
3. Venue name
4. Area / location
5. Report count / timestamp

Any component that inverts this order has a hierarchy problem.

---

## When not to add something

The instinct to add is almost always wrong. Before adding any element, ask:

- Does this help the user make a decision they couldn't make without it?
- Does this replace something, or does it add to an already-full screen?
- Is this data real, current, and meaningful — or decorative?
- Would a first-time user understand this, or is it only impressive on a demo?

The explore list currently shows: status bar, venue name, area, wait time, trend indicator, report count, sparkline. That is already dense. Adding more requires removing something first.

---

## What makes this product distinctive

QueueBar is not a generic venue discovery app. It is a **real-time decision tool for a specific social context** — you are standing outside a bar or deciding where to go in the next 20 minutes. Every design decision should serve that context.

That means:
- Information should be scannable at arm's length, in low light, with noise
- The most urgent information (long queues) should be impossible to miss
- Actions should be completable in under 10 seconds
- The product should feel calm under information load — not exciting, calm
- Swedish language throughout, Swedish venue conventions (area names, not street addresses)

Do not design for the demo or the screenshot. Design for the person standing outside Södra Teatern at 23:00 on a Friday.

---

## Avoiding generic AI design

The patterns below are not prohibited. They are defaults — what appears when there is no design thinking. Prefer them only when they are genuinely the best solution.

**Overused defaults to challenge before using:**
- Repeated card grid with icon + heading + number + description
- Status badge pills where text or color alone would communicate better
- Skeleton loading screens where a simpler empty state would be cleaner
- Charts that show trends without enabling any action on them
- Insight tiles ("Tonight looks busy!") with no data backing and no decision value
- Animations that play on every render rather than on state change

**QueueBar-specific anti-patterns already documented:** see `/anti-ai-design`

---

## After implementing

1. Run `node scripts/check.js` — all 38 checks must pass
2. Visually verify with `?testdata=true` — both the data-present and empty states
3. Check the five-second test: is the most important information still the most visible?
4. Ask: did this change make the product more useful, or just different?

---

## Relationship to other skills

| Skill | When to use |
|-------|-------------|
| `/ui-audit` | Structured audit of a specific screen, produces P0-P3 findings |
| `/anti-ai-design` | Grep-based removal of decorative patterns |
| `/premium-design` | Typography and spacing precision checklist |
| `/fintech-product-thinking` | This file — operating philosophy and independent judgment |

Load this skill to think. Load the others to audit.
