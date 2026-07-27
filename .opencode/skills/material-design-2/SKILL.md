---
name: material-design-2
description: Build and review the React Material UI dashboard using Material Design 2 visual hierarchy, geometry, density, elevation, interaction, accessibility, and responsive patterns.
compatibility: opencode
metadata:
  domain: dashboard
  design-system: material-design-2
---

# Material Design 2 dashboard

Use the official `mui` MCP server for current Material UI APIs and examples. Call `useMuiDocs` for the relevant package first, then call `fetchDocs` only with URLs returned by the MCP. Separate API correctness from visual language: newer MUI documentation may demonstrate Material 3-like defaults, while this project intentionally targets Material Design 2.

## Visual language

- Base typography on Roboto with clear MD2 roles and restrained weights.
- Prefer compact 4 px surface radii. Avoid pervasive 12–24 px rounding and pill-shaped containers.
- Use elevation and surface hierarchy selectively. Do not outline every region or nest cards without purpose.
- Use a conventional app bar, drawer/list navigation, cards, dialogs, data tables, text fields, buttons, chips, tooltips, and snackbars according to their semantic roles.
- Navigation selection should read as a list state, not a large floating pill.
- Chips are status or compact metadata, not general-purpose buttons.
- Use standard MD2 control density and at least 44–48 px touch targets where interaction requires it.
- Keep light and dark palettes contrast-safe. Do not derive critical contrast from a primary color that changes meaning between modes.

## Information architecture

- Put status and key metrics first, then operational detail.
- Keep labels stable across views and normalize raw internal enums into readable text.
- Preserve complete values for public keys, topics, client IDs, errors, and timestamps through wrapping, detail views, or accessible tooltips.
- Use explicit empty, loading, stale-data, partial-error, and fatal-error states.
- Keep previous valid data visible when refresh fails unless no valid snapshot has ever loaded.

## Responsive behavior

- Design explicitly for approximately 320, 390, 600, 900, 1024, 1200, and wide desktop widths.
- Do not render a desktop table merely clipped inside a narrow viewport.
- Use responsive record cards or lists where columns cannot fit. Preserve sorting and all essential fields.
- Do not activate a permanent drawer at a width that leaves too little content space for the selected representation.
- Mobile dialogs may become full-screen. Ensure close controls do not shrink and content wraps.
- Avoid horizontal scrolling unless the data is inherently matrix-like and a responsive representation would lose meaning.

## Accessibility and interaction

- Provide keyboard activation for clickable rows and visible focus.
- Use semantic buttons rather than clickable chips or generic boxes.
- Give icon-only controls accessible labels and tooltips where meaning is not obvious.
- Use unique form-control IDs and associated labels.
- Do not encode state by color alone.
- Respect reduced motion and avoid screenshot/test logic that captures mid-transition states.
- DeepSeek V4 Pro is text-only. Validate these rules through theme/source inspection and objective browser evidence; do not claim screenshot vision.

## Implementation discipline

- Prefer theme component overrides and reusable project primitives over scattered one-off `sx` values.
- Use deterministic sort tie-breakers.
- Keep hooks unconditional and avoid stale closures for refreshed data.
- Preserve the ES2020 target.
- Update visual fixtures and generate screenshots for human review, but verify behavior with source, DOM, accessibility, computed styles, geometry, overflow, keyboard, console, and contrast evidence. Never claim to have inspected screenshot pixels.
