# Dashboard UI audit and remediation

## Scope

The review covered the supplied codebase and all 39 supplied dashboard captures, including desktop, mobile, dark mode, dialogs, sorting states, the MeshCore.io map, and widths from 320 to 1440 pixels.

The implementation was revised toward **Material Design 2** rather than Material 3. The visual system uses compact MD2 geometry, Roboto typography, restrained elevation, rectangular selected navigation, and the Meshat.se green identity.

## Issues found and changes made

|   # | Area                  | Issue found                                                                                                                          | Resolution                                                                                                                                                       |
| --: | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Application shell     | The permanent drawer and app bar occupied the same upper-left area, producing duplicated and clipped branding.                       | Split the shell into a dedicated 240 px drawer brand area and an app bar offset by the drawer width.                                                             |
|   2 | Mobile navigation     | The mobile drawer repeated product branding and the screenshot workflow captured it during its opening transition.                   | Removed duplicate mobile branding, positioned the drawer below the app bar, and added a transition wait to the screenshot harness.                               |
|   3 | Design language       | Large radii, pill-shaped navigation, outlined surfaces everywhere, and oversized controls read as Material 3 rather than Material 2. | Rebuilt the theme around 4 px MD2 geometry, standard MD2 button/input heights, compact table density, restrained elevation, and rectangular selected navigation. |
|   4 | Meshat.se identity    | The dashboard did not have a coherent product identity or hierarchy.                                                                 | Applied Meshat.se green as the primary accent, added a dedicated Meshat.se Operations brand block, and used a dark green MD2 app bar.                            |
|   5 | Dark mode contrast    | The original dark accent treatment and some newly inherited contrast values were too weak against dark surfaces.                     | Uses a lighter teal primary in dark mode, keeps the app bar and drawer brand text white, and adjusted map legend colors for readable white labels.               |
|   6 | App-bar timestamp     | A missing or zero timestamp could render a bogus update time.                                                                        | The update label is omitted unless the timestamp is finite and greater than zero.                                                                                |
|   7 | Metric cards          | Summary cards were visually oversized and contained excessive unused space.                                                          | Reduced the content hierarchy to a compact 64 px core row with a 40 px icon treatment and denser MD2 spacing.                                                    |
|   8 | Responsive tables     | Desktop tables were simply squeezed or clipped on mobile in observers, bans, subscribers, overview, workers, and upload history.     | Added complete responsive record-card layouts below the large breakpoint; desktop retains dense sortable tables.                                                 |
|   9 | 900–1024 px layout    | The permanent 240 px drawer appeared at 900 px while six-column tables still rendered, leaving an unusably narrow content area.      | Record-card layouts now remain active through narrow desktop/tablet widths and switch to tables only at 1200 px.                                                 |
|  10 | 320–390 px layouts    | Labels, statuses, controls, and values competed for the same row and could compress or escape cards.                                 | Added minimum-width protection, wrapping, two-column fallback grids, non-shrinking status badges, and full-width filter/sort controls.                           |
|  11 | Observer dialog       | The mobile observer dialog contained a desktop neighbor table, overflowing public keys and long raw SNR values.                      | Mobile/tablet uses neighbor cards, full wrapping keys, one-decimal SNR values, readable status labels, and responsive scope chips.                               |
|  12 | Dialog behavior       | Mobile dialogs remained floating desktop modals with reduced usable width.                                                           | Observer, ban, and subscriber dialogs become full-screen below the small breakpoint and keep MD2 dialogs on larger screens.                                      |
|  13 | Long identifiers      | Public keys, client IDs, usernames, broker IDs, topics, labels, and error text could overflow or be silently clipped.                | Added safe wrapping, selectable code surfaces, full-value title attributes where truncation remains appropriate, and minimum-width safeguards.                   |
|  14 | Topic visibility      | Subscriber and observer topics were reduced to ellipses without a reliable way to inspect the complete value.                        | Detail views now wrap full topic strings; desktop table truncation retains a full-value title.                                                                   |
|  15 | Mobile sorting        | Card layouts removed the table headers but offered no replacement sorting controls.                                                  | Added a reusable MD2 mobile sort control with field selection and direction toggle to observers, bans, subscribers, workers, history, and observer messages.     |
|  16 | Sort stability        | Equal values could change order between refreshes and produce visual jumping.                                                        | Added deterministic tie-breakers across observer, ban, subscriber, worker, message, and history sorting.                                                         |
|  17 | Repeated form IDs     | Reused sort controls could generate duplicate input/label IDs.                                                                       | The shared mobile sort component now uses React `useId()` for unique label associations.                                                                         |
|  18 | Keyboard access       | Clickable desktop table rows only worked with a mouse.                                                                               | Added focusability plus Enter and Space activation while retaining hover/click behavior.                                                                         |
|  19 | Search usability      | Search fields had no direct clear action.                                                                                            | Added an accessible clear button with tooltip and `aria-label`.                                                                                                  |
|  20 | Action semantics      | Action chips were used where actual buttons were expected.                                                                           | Replaced action-like chips with MD2 text/outlined buttons; status chips remain display-only.                                                                     |
|  21 | Status language       | Raw values such as `send_failed`, `would_mute`, and inconsistent “Idle”/“Disabled” labels leaked into the UI.                        | Centralized or normalized user-facing labels such as Blocked, Warning, Disabled, Responded, Timed out, and Send failed.                                          |
|  22 | Protection reasons    | Internal underscored reason codes appeared in lists and details.                                                                     | Added shared public reason formatting and used it consistently in overview, bans, and observer protection details.                                               |
|  23 | Empty states          | Empty topic arrays and missing connection details produced blank sections.                                                           | Added explicit “No topics reported” and “No active connection details” states.                                                                                   |
|  24 | Stale dialogs         | Open observer, ban, or subscriber dialogs could continue showing removed or outdated snapshot objects.                               | Dialog selections now refresh from each new snapshot and close automatically if the record disappears.                                                           |
|  25 | Refresh failures      | A temporary API failure replaced the whole dashboard despite claiming previous data remained visible.                                | Existing snapshot data now remains rendered with a warning banner; a blocking error is shown only when no snapshot exists.                                       |
|  26 | API error payload     | An error payload could be installed as a full snapshot and later crash views that expect complete arrays.                            | Error payloads no longer replace the current snapshot.                                                                                                           |
|  27 | React hooks           | MeshCore.io returned before later `useMemo` calls when disabled, violating hook ordering if enabled state changed.                   | Moved all hooks above the conditional return and introduced stable empty-array constants.                                                                        |
|  28 | Map refresh behavior  | Map marker click callbacks captured the first advert array and could open the wrong record after refresh.                            | Marker properties store an advert index and the click handler reads the current advert array through a ref.                                                      |
|  29 | Map failure           | Failed map styles/tiles left an effectively blank panel with no useful data fallback.                                                | Added loading/error overlays and a coordinate list fallback showing up to 20 adverts when the map cannot load.                                                   |
|  30 | Map legibility        | The sensor legend orange had weak contrast with white text, and the map had no clear fit control or selected-item summary.           | Darkened the sensor color, added a Fit adverts button, data-driven bounds, responsive map height, and selected advert details.                                   |
|  31 | MeshCore.io semantics | The Uploads card used a bug icon, zero dropped uploads were always red, and worker capacity/errors were hidden.                      | Uses a cloud-complete icon, applies error color only to non-zero failures, and exposes configured worker slots plus worker errors.                               |
|  32 | Recent publishes      | Missing observer identity rendered as an empty string.                                                                               | Displays an em dash when neither observer name nor public key is available.                                                                                      |
|  33 | Compatibility         | `replaceAll` was used despite the dashboard declaring an ES2020 target, and map typing depended on a global GeoJSON namespace.       | Replaced the ES2021-only call and used local structural geometry typing.                                                                                         |
|  34 | Screenshot targeting  | Subscriber-dialog captures waited for the `visual-review` record but then opened the first row.                                      | Added a row-by-text helper and use it consistently on desktop and mobile.                                                                                        |
|  35 | Screenshot coverage   | The row helper assumed desktop table rows and did not reliably support the new card layouts.                                         | Updated capture locators to support visible responsive cards or table rows and retained horizontal-overflow assertions.                                          |

## Main files changed

- `dashboard/src/theme.ts`
- `dashboard/src/app.tsx`
- `dashboard/src/components/layout/app-shell.tsx`
- `dashboard/src/components/layout/top-app-bar.tsx`
- `dashboard/src/components/details/observer-detail.tsx`
- `dashboard/src/components/details/ban-detail.tsx`
- `dashboard/src/components/details/subscriber-detail.tsx`
- `dashboard/src/components/shared/metric-card.tsx`
- `dashboard/src/components/shared/status-badge.tsx`
- `dashboard/src/components/ui/mobile-sort-controls.tsx` (new)
- `dashboard/src/components/ui/search-bar.tsx`
- `dashboard/src/components/ui/region-filter.tsx`
- `dashboard/src/views/overview.tsx`
- `dashboard/src/views/observers.tsx`
- `dashboard/src/views/bans.tsx`
- `dashboard/src/views/subscribers.tsx`
- `dashboard/src/views/meshcore-io.tsx`
- `dashboard/src/helpers/format.ts`
- `scripts/capture-dashboard-screenshots.mjs`

## Validation performed

- Parsed all 29 dashboard TypeScript/TSX files with the TypeScript parser using the project’s ES2020 target: no syntax errors.
- Ran `node --check scripts/capture-dashboard-screenshots.mjs`: no syntax errors.
- Ran `npm run check:lockfile`: passed; the lockfile contains portable resolved URLs.
- Confirmed the final package contains no `.git` directory, staged state, `node_modules`, or generated `dist` output.

## Validation limitation

A dependency-backed `npm run build`, lint, Prettier check, and fresh Playwright screenshot pass could not be completed in this environment. `npm ci` repeatedly failed because the configured package gateway returned HTTP 503 for package tarballs. The environment also reports an engine warning because its Node.js 22.16.0 is older than the range requested by `ini@7.0.0` (`^22.22.2 || ^24.15.0 || >=26`).
