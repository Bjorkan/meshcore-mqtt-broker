# Dashboard instructions

These instructions apply to the Vite/React dashboard under `dashboard/`. Read the root `AGENTS.md` first.

## Scope and architecture

- `src/app.tsx`: application composition, snapshot lifecycle, loading, refresh, and fatal/non-fatal errors.
- `src/theme.ts`: central Material Design 2 theme and component overrides.
- `src/components/layout/`: app bar, drawer, and page shell.
- `src/components/shared/`: tables, metric cards, statuses, empty states, and reusable responsive primitives.
- `src/components/details/`: observer, ban, and subscriber details.
- `src/views/`: overview, observers, bans, subscribers, and MeshCore.io.
- `src/api.ts`, `types.ts`, `router.ts`, and `helpers/`: API contract, navigation, formatting, and data types.

Do not change server API semantics from the dashboard. Coordinate API/type changes with `src/dashboard.ts`, `API_DEVELOPMENT.md`, and backend tests.

## Text-only model constraint

The configured model is DeepSeek V4 Pro. It has no native vision capability. Treat screenshots and image attachments as opaque artifacts.

- Never claim that a screenshot was visually inspected, compared, or judged.
- Use source plus DOM, accessibility, computed-style, geometry, overflow, keyboard, console, and contrast evidence for UI conclusions.
- A screenshot capture is useful for a human reviewer but does not prove appearance or polish.
- The Material UI MCP supplies official documentation and examples only; it cannot inspect the running dashboard.
- Put subjective questions such as visual balance, aesthetic polish, or perceived hierarchy in a human-review section.

## Material Design 2 target

Use the official Material UI MCP configured in `opencode.jsonc` for current component APIs and accessibility guidance, but keep the visual language Material Design 2 rather than adopting Material Design 3 defaults. Call `useMuiDocs` first and follow only documentation URLs returned through `fetchDocs`.

- Use conventional MD2 app bar, drawer, list navigation, typography, spacing, 4 px surface radii, and restrained elevation.
- Avoid pill-shaped navigation, oversized rounded cards, tonal surface stacks, huge controls, and outlined containers around every section.
- Use chips for compact status or metadata, not as general navigation or action buttons.
- Centralize reusable color, shape, density, and component behavior in `theme.ts` or shared components. Avoid scattered one-off `sx` values.
- A project-specific brand palette is optional; consistency, contrast, and MD2 hierarchy are mandatory.

## Responsive behavior

Design and verify at approximately 320, 390, 600, 900, 1024, 1200, and wide desktop widths.

- Do not squeeze a desktop table until columns clip or become unreadable.
- Use complete, sortable cards/lists below the width where the table is genuinely usable.
- Do not hide essential fields to make a layout fit.
- Avoid horizontal scrolling when a responsive record representation is clearer.
- Ensure drawer, app bar, content offset, dialogs, maps, filters, and sort controls work at every breakpoint.
- Mobile dialogs may become full-screen when that improves usable space.

## Interaction and accessibility

- Keep interactive targets at least 44–48 px where practical.
- Preserve native keyboard order, visible focus, semantic buttons/links, labels, `aria-sort`, and Enter/Space activation for clickable records.
- Use unique IDs for repeated controls.
- Handle long public keys, topics, client IDs, broker IDs, error strings, and translated text without clipping or escaping containers.
- Show explicit loading, empty, warning, partial-data, and fatal-error states.
- A refresh failure must not discard the last valid snapshot when the UI claims that data remains visible.
- Avoid stale snapshot objects and stale closures in dialog selection, map callbacks, and refreshed collections.
- Keep React hooks unconditional and stable across enabled/disabled states.
- Verify light and dark modes with sufficient contrast; do not rely on color alone for status.

## Data presentation

- Use deterministic sort tie-breakers so refreshes do not randomly reorder equal values.
- Format units and precision consistently.
- Convert internal reason/status codes to readable labels while retaining the exact value where diagnosis benefits.
- Preserve complete data access through wrapping, detail views, or accessible titles/tooltips.
- Map views need a useful loading/error fallback and must never present stale clicked records after refresh.

## Verification

Run:

```bash
npm run build:dashboard
npm run format:check
npm run lint
```

For behavior shared with the API, run the relevant Jest tests. For visual changes, seed a representative dashboard and run:

```bash
npm run dashboard:seed-demo
npm run dashboard:screenshots
```

Generate captures for all relevant states, not only the first overview. Cover desktop/mobile, light/dark, drawers, dialogs, sort directions, long data, empty/error states, and breakpoint transitions. Because the model is text-only, pair the capture run with Playwright assertions for accessible state, computed styles, element bounds, intersections, overflow, target sizes, focus/keyboard behavior, console errors, and content completeness. Provide capture paths for human review and never claim to have visually inspected them. Do not commit generated screenshot artifacts.
