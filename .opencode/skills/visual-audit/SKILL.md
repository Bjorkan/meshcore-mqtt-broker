---
name: visual-audit
description: Perform a systematic text-only UI audit across breakpoints, themes, dialogs, tables/cards, realistic long data, and interaction states using source and objective browser evidence; generate screenshots only as human-review artifacts.
compatibility: opencode
metadata:
  domain: dashboard
  workflow: browser-evidence
---

# Text-only UI audit

DeepSeek V4 Pro cannot inspect image pixels. Do not claim to review, see, or compare screenshots. Audit rendered behavior through source and explicit browser/tool output. Screenshots may be generated for a human reviewer or compared mechanically to an already reviewed baseline.

## Required state matrix

Exercise applicable combinations of:

- light and dark mode,
- 320 and 390 px mobile,
- 600 px small tablet,
- 900 and 1024 px narrow desktop/tablet,
- 1200 px desktop and a wider desktop,
- drawer closed/open and permanent drawer,
- every route,
- each detail dialog,
- loading, empty, populated, refresh warning, fatal error,
- short and pathological long values,
- zero, warning, and error metric values,
- ascending and descending sorting,
- keyboard focus and activation.

## Objective browser evidence

Collect applicable evidence with Playwright or equivalent tooling:

- accessible roles, names, descriptions, and focus order,
- visible text and complete record fields,
- computed font, spacing, radius, color, background, display, position, and overflow values,
- bounding boxes and viewport intersections,
- overlap and clipping checks between app bar, drawer, content, dialogs, controls, and fixed elements,
- document and component `scrollWidth` versus `clientWidth`,
- minimum interactive target sizes,
- dialog containment and close-control reachability,
- keyboard Enter/Space/Escape behavior,
- sort order and deterministic ties,
- browser console errors, page errors, failed resources, and React warnings,
- contrast calculations from resolved foreground/background colors where feasible,
- machine screenshot-diff results only when the baseline was previously accepted by a human.

Do not treat OCR, average colors, image dimensions, or a zero process exit as a semantic visual review.

## Source review checklist

- App bar and drawer cannot overlap or duplicate branding.
- Breakpoints account for drawer width and actual table column requirements.
- Mobile representations retain all essential data and sorting.
- Dialogs are usable at narrow widths and long content wraps.
- Touch targets are large enough and cannot shrink.
- Raw enum/reason strings are formatted for users.
- Missing timestamps and values do not produce misleading content.
- Equal sort values use deterministic tie-breakers.
- Form IDs are unique.
- Hooks are never conditional.
- Event handlers and map markers do not capture stale snapshots.
- Refresh errors preserve previous valid data.
- Error payloads cannot replace valid snapshots.
- Empty sections explain that they are empty.
- Icons semantically match metric meaning and error colors depend on actual error state.

## Screenshot harness

- Locate intended records by identifying text rather than assuming the first row.
- Support both table rows and responsive cards.
- Wait on observable readiness and settled dialogs/drawers, not arbitrary long sleeps.
- Keep fixtures deterministic and include long keys, topics, IDs, messages, and scope lists.
- Capture the exact breakpoint around each layout transition.
- Save stable, descriptive artifact names for human review.
- Never report screenshot content unless a configured vision-capable tool explicitly analyzed it.

## Reporting

For every confirmed issue, record the observable browser/source symptom, exact evidence, root cause, affected widths/states, source location, and fix. Separate:

1. machine-verified functional/accessibility/layout failures,
2. source-level design-system violations,
3. subjective visual questions that remain unverified without vision.
