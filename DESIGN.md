---
version: alpha
name: MeshCore MQTT Broker
description: Calm, precise public network monitoring for regional MeshCore operations.
colors:
  signal-green: "#006c4c"
  relay-mint: "#86f8c8"
  relay-ink: "#002116"
  navigation-mint: "#cbead9"
  navigation-ink: "#052018"
  error-red: "#ba1a1a"
  error-wash: "#ffdad6"
  warning-amber: "#805600"
  fog-surface: "#f6f9f6"
  panel-white: "#ffffff"
  nested-fog: "#eff4f0"
  raised-fog: "#e3e9e4"
  ink: "#171d19"
  ink-muted: "#414943"
  outline: "#717972"
  border: "rgba(70, 82, 74, 0.16)"
  border-strong: "rgba(70, 82, 74, 0.24)"
  hover-state: "rgba(23, 29, 25, 0.06)"
  pressed-state: "rgba(23, 29, 25, 0.11)"
  focus-ring: "rgba(0, 108, 76, 0.42)"
  modal-scrim: "rgba(3, 10, 6, 0.68)"
  map-repeater-green: "#087f5b"
  map-room-blue: "#2f6f89"
  map-sensor-amber: "#a15c00"
  map-neutral: "#5e6d64"
typography:
  display:
    fontFamily: 'Aptos, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: 43px
    fontWeight: 610
    lineHeight: 1.1
    letterSpacing: -1.1px
  headline:
    fontFamily: 'Aptos, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: 23px
    fontWeight: 740
    lineHeight: 29px
    letterSpacing: -0.55px
  title:
    fontFamily: 'Aptos, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: 17px
    fontWeight: 710
    lineHeight: 23px
    letterSpacing: -0.25px
  body:
    fontFamily: 'Aptos, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  navigation:
    fontFamily: 'Aptos, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: 13px
    fontWeight: 640
    lineHeight: 20px
    letterSpacing: 0.05px
  label:
    fontFamily: 'Aptos, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: 10px
    fontWeight: 750
    lineHeight: 16px
    letterSpacing: 0.9px
  metric:
    fontFamily: 'Aptos, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: 31px
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: -0.75px
  data-mono:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
    fontSize: 10px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0px
rounded:
  xs: 6px
  sm: 10px
  md: 14px
  dialog: 16px
  lg: 18px
  xl: 24px
  full: 999px
spacing:
  micro: 6px
  compact: 10px
  control-gap: 14px
  section-gap: 16px
  card-inset: 18px
  panel-inset: 22px
  page-gutter: 24px
  mobile-gutter: 14px
components:
  action-button:
    backgroundColor: transparent
    textColor: "{colors.signal-green}"
    typography: "{typography.navigation}"
    rounded: "{rounded.full}"
    padding: 0px 18px
    height: 44px
  action-button-hover:
    backgroundColor: "{colors.hover-state}"
    textColor: "{colors.signal-green}"
  navigation-active:
    backgroundColor: "{colors.navigation-mint}"
    textColor: "{colors.navigation-ink}"
    typography: "{typography.navigation}"
    rounded: "{rounded.full}"
    padding: 0px 14px
    height: 48px
  field:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 0px 14px
    height: 48px
  section-card:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 22px
  metric-card:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 18px
  subscription-chip:
    backgroundColor: "{colors.nested-fog}"
    textColor: "{colors.ink}"
    typography: "{typography.data-mono}"
    rounded: "{rounded.xs}"
    padding: 4px 8px
  map-item-selected:
    backgroundColor: "{colors.relay-mint}"
    textColor: "{colors.relay-ink}"
    rounded: "{rounded.sm}"
    padding: 10px
---

# Design System: MeshCore MQTT Broker

## Scope

This design system governs the browser dashboard shell and React application served at `/`. It does not restyle the separately routed Swagger UI at `/api/docs`, whose local `swagger-ui-dist` assets intentionally retain their upstream interaction patterns. The dashboard remains a read-only client of `/api/dashboard`; future API-only functionality does not imply a new dashboard view unless that view is designed and implemented explicitly.

## Overview

**Creative North Star: "Regional Signal Room"**

The interface should feel like entering a composed regional signal room: live radio-network activity is visible, ordered, and credible without becoming theatrical. Cool fog surfaces, exact green signals, compact labels, and generous containment create a calm, precise, trustworthy public-monitoring environment.

The system is operational rather than promotional. Its defining tension is **soft shell, hard data**: rounded, lightly lifted containers protect dense identifiers, timestamps, statuses, and tables without softening their meaning. Visual hierarchy is quiet but decisive, and urgency appears only when real state requires it. Avoid command-centre theatre: no neon-on-black cyber styling, glowing gauges, radar cliches, or manufactured urgency.

**Key Characteristics:**

- Cool green-tinted surfaces with one disciplined signal accent.
- Compact, exact data typography inside softly rounded containment.
- Layered tonal depth with sparse ambient lift.
- Public clarity without decorative dashboard spectacle.
- Responsive transformations that preserve labels and operational meaning.

## Colors

The palette moves from **Fog Surface** through white and pale green containers, with **Signal Green** reserved for identity, interaction, and affirmative network state.

### Primary

- **Signal Green** (`colors.signal-green`): Brand marks, interactive text, focused fields, publish times, and successful status.
- **Relay Mint** (`colors.relay-mint`): Icon wells and selected network objects; always pair it with Relay Ink.
- **Relay Ink** (`colors.relay-ink`): Foreground content placed on Relay Mint.

### Secondary

- **Navigation Mint** (`colors.navigation-mint`): The selected navigation state.
- **Navigation Ink** (`colors.navigation-ink`): Text and icons on Navigation Mint.
- **Repeater Green** (`colors.map-repeater-green`): The fixed map identity for repeater adverts.
- **Room Blue** (`colors.map-room-blue`): The fixed map identity for room adverts.
- **Sensor Amber** (`colors.map-sensor-amber`): The fixed map identity for sensor adverts.
- **Map Neutral** (`colors.map-neutral`): The fallback identity for uncategorized map adverts.

### Tertiary

- **Error Red** (`colors.error-red`) and **Error Wash** (`colors.error-wash`): Failed refreshes, denied states, and blocking events.
- **Warning Amber** (`colors.warning-amber`): Warning-only and review-required states.

### Neutral

- **Fog Surface** (`colors.fog-surface`): The page canvas and top-bar base.
- **Panel White** (`colors.panel-white`): Primary panels, fields, metrics, and dialogs.
- **Nested Fog** (`colors.nested-fog`): Drawers, table headers, subordinate data regions, and chips.
- **Raised Fog** (`colors.raised-fog`): Map frames, counters, and higher neutral emphasis.
- **Ink** (`colors.ink`): Primary text and numeric values.
- **Muted Ink** (`colors.ink-muted`): Labels, metadata, supporting copy, and inactive controls.
- **Outline** (`colors.outline`): Form-control borders.
- **Border** and **Border Strong** (`colors.border`, `colors.border-strong`): Ordinary separators and stronger interactive boundaries.

### Theme Behavior

Theme initially follows the operating system through `prefers-color-scheme`. The top app bar exposes a labeled light/dark toggle; an explicit choice is stored in local browser storage and applied before styles load to prevent a theme flash. Dark mode remaps Signal Green to `#69dba9`, Relay Mint to `#005139`, Navigation Mint to `#314c40`, Fog Surface to `#101512`, Panel White to `#0b0f0d`, Nested Fog to `#171c18`, Raised Fog to `#262c27`, Ink to `#e0e4df`, Muted Ink to `#c1c9c2`, Error Red to `#ffb4ab`, and Warning Amber to `#f5bd63`. Fixed map-category hues remain stable across themes, and map tiles follow the active dashboard theme.

**The One Signal Rule.** Signal Green carries identity, interaction, focus, time, and healthy state; do not introduce another general-purpose accent.

**The Paired Container Rule.** Every colored container uses its matching foreground token; Relay Mint uses Relay Ink, and Navigation Mint uses Navigation Ink.

**The Selected Theme Rule.** Every new surface, state, shadow, and boundary must remain coherent in both themes and use the dashboard's resolved theme rather than querying the operating system independently.

## Typography

**Display Font:** Aptos with Segoe UI Variable Text and the system sans-serif stack as fallbacks
**Body Font:** Aptos with Segoe UI Variable Text and the system sans-serif stack as fallbacks
**Label/Mono Font:** SFMono-Regular with Consolas and Liberation Mono as fallbacks

**Character:** The sans-serif system is neutral, compact, and highly legible, with unusually exact intermediate weights where available. Negative tracking gives major titles and metrics authority; small labels organize dense information without competing with it. Monospace is reserved for keys, MQTT topics, and protocol literals.

### Hierarchy

- **Display** (weight 610, `clamp(31px, 3.2vw, 43px)`, line-height 1.1): One page title per view; it becomes 28px/34px below 800px.
- **Headline** (weight 740, 23px/29px): Dialog titles and highest overlay hierarchy; it becomes 20px/26px on mobile.
- **Title** (weight 710, 17px/23px): Section headings; it becomes 16px/22px on mobile.
- **Body** (weight 400, 15px/1.5): Page descriptions and general interface copy; the root becomes 14px below 800px.
- **Navigation** (weight 640, 13px/20px): Persistent route labels and compact controls.
- **Metric** (weight 650, up to 31px/1.1): Current counts and rates, with tight negative tracking; it reduces to 24px on narrow phones.
- **Label** (weight 720-780, 8-11px): Table labels and metadata headings; tracking expands as size decreases.
- **Data Mono** (weight 500-680, 9-11px): Public keys, MQTT topics, subscriptions, and protocol references.

**The Quiet Hierarchy Rule.** Create hierarchy with size, weight, and spacing before adding color; body copy remains neutral and Signal Green is not a substitute for typographic structure.

**The Hard Data Rule.** Long identifiers must truncate or wrap safely, and protocol material stays monospace without turning the whole interface into a developer console.

## Layout

The desktop shell uses a fixed 248px navigation drawer, a sticky 64px top app bar, and a centered content field capped at 1320px. Main horizontal gutters are fluid from 24px to 44px. Page headings use direct title-and-description hierarchy before compact 12-16px section gaps begin. Operational metrics share one bordered strip with three segments for the broker overview and four for MeshCore.io, while primary content favors an asymmetric wide-main/narrow-support split.

At 1120px the drawer narrows to 224px, metrics move to two columns, and content grids become single-column. At 920px the drawer becomes an off-canvas sheet with a scrim, the frame loses its left offset, and map/list layouts stack. At 800px the interface changes mode: gutters become 14px, panels tighten, filters stack, desktop table headers disappear, and rows become labeled two-column cards. At 460px detail and map lists become one column; at 340px metrics and table cards also become one column.

Spacing is pragmatic rather than a strict mathematical scale. Reuse the documented 6px micro gap, 10px compact gap, 14px control gap, 16px section gap, 18px card inset, and 22px panel inset before introducing a new interval. Keep controls at least 44px tall and continue honoring viewport safe areas.

**The Collapse Without Loss Rule.** Responsive adaptation may change topology, but never remove the label, status text, or context needed to understand operational data.

## Elevation & Depth

The system is **layered, lightly lifted**. Tonal steps establish most hierarchy: Fog Surface supports Panel White, while Nested Fog marks drawers, headers, and subordinate regions. One-pixel translucent borders define edges. Major section cards receive a low ambient two-part shadow; metric strips rely on separators rather than individual card shadows; dialogs receive the strongest elevation over a blurred scrim. Mobile panels flatten slightly as their radius and shadow reduce.

### Shadow Vocabulary

- **Panel ambient** (`0 1px 2px rgba(21, 31, 25, 0.05), 0 8px 24px rgba(21, 31, 25, 0.045)`): Primary section surfaces and map containers.
- **Dialog lift** (`0 20px 60px rgba(13, 24, 18, 0.25), 0 4px 16px rgba(13, 24, 18, 0.18)`): Modal overlays only.
- **Popover lift** (`0 16px 42px rgba(13, 24, 18, 0.16), 0 3px 10px rgba(13, 24, 18, 0.1)`): Search results and other anchored transient surfaces.
- **Translucent chrome** (`18px` and `14px` backdrop blur): The top app bar and sticky modal headers; this is depth by diffusion rather than box shadow.

**The Layer Before Lift Rule.** Use a surface tone and border before adding a shadow; only major containers, floating results, drawers, and dialogs earn elevation.

**The Dark Shadow Rule.** Any reusable new shadow requires an explicit dark-theme value rather than relying on a light-theme fixed alpha.

## Shapes

The form language is protective and softly engineered. Tiny chips use 6px corners, controls and mobile row cards use 10px, grouped data surfaces use 14px, major surfaces use 18px, and operational dialogs use 16px. Navigation and text actions are fully pill-shaped; dialog close controls are compact rounded squares. Status is carried by text; icon wells use near-square 10-13px corners rather than circles.

The 24px brand mark uses a 5px corner and rounded radio-tower strokes. Borders are normally one pixel and low contrast; stronger borders are reserved for drawer separation, selected map items, and interactive controls.

**The Radius Hierarchy Rule.** Radius communicates containment scale: 6px for chips, 10px for controls, 14px for grouped data, 16px for dialogs, 18px for primary sections, and full pills for navigation and text actions.

## Components

Components follow **soft shell, hard data**: generous hit areas and rounded containment surround compact, exact content.

### Buttons

- **Shape:** Fully pill-shaped, with a minimum 44px action height and 46px icon-button square.
- **Primary action:** The incumbent primary action is transparent with Signal Green text and 18px horizontal padding, not a filled brand button.
- **Hover / Focus:** Fine pointers receive the shared translucent hover state; press uses the stronger state layer. Keyboard focus uses a 3px Signal Green ring with a 2px offset.
- **Icon:** Use inline, current-color SVG geometry at 18-22px; icon-only controls require an accessible label.
- **Theme icon:** Use the simple sun and crescent paths only; avoid decorative stars or compound weather symbols. The radio-tower mark remains Signal Green and is not recolored by this control.

### Chips

- **Style:** Subscription topics use Nested Fog, a subtle border, 6px corners, 4px by 8px padding, and compact monospace text.
- **State:** Count and overflow chips use full pills and Raised Fog. Chips are informational unless interaction is explicit.

### Cards / Containers

- **Corner Style:** 14px for grouped metric and data surfaces; 18px for primary sections.
- **Background:** Panel White for primary content and Nested Fog for subordinate content.
- **Shadow Strategy:** Follow the Layer Before Lift Rule; grouped and nested data surfaces remain unshadowed.
- **Border:** One-pixel translucent Border around contained data groups, with one-pixel internal separators.
- **Internal Padding:** 18px for metric segments and 22px for primary panel bodies; mobile panels tighten to 13-16px.

### Inputs / Fields

- **Style:** 48px high, Panel White background, Outline border, 10px corners, and 14px horizontal padding.
- **Focus:** Border changes to Signal Green with a one-pixel outer reinforcement; never remove keyboard visibility without an equally strong replacement.
- **Search / Select:** Search reserves 44px at the leading edge for a 20px icon. Selects use the incumbent compact chevron and 42px trailing reserve.
- **Lookup Results:** The lookup field and results share a 720px maximum width and one continuous outline. Opening the results squares the input's lower corners and joins the results at `top: calc(100% - 1px)` with no visual gap; the combined control still overlays following content and supports count guidance, keyboard traversal, and a no-results state.

### Navigation

- Desktop navigation lives in the fixed low-surface drawer. Items are 48px high, pill-shaped, and use compact 13px semibold text with 20px icons.
- The active route uses Navigation Mint and Navigation Ink through `aria-current="page"`. Hover is a neutral state layer, not a second accent.
- Subscribers use the network-access glyph rather than a generic cluster of people, distinguishing connections from observer identities.
- The top app bar carries the current light/dark theme control next to snapshot time. Desktop shows icon and mode text; mobile preserves a 42px icon-only target with an action-oriented accessible label.
- Below 920px the drawer becomes a focus-trapped off-canvas sheet with a blurred scrim, explicit close control, Escape handling, and focus restoration.

### Tables and Data Lists

- Desktop tables use 44px low-surface headers, 56px body rows, compact 12px content, and one-pixel row separators.
- Sort controls occupy the full header cell and use Signal Green only for the active arrow.
- Below 800px, tables become bordered two-column cards. Every cell that survives must provide a meaningful `data-label`; primary cells span the full width.

### Status

- Status always uses an explicit text label. Healthy uses Signal Green, warning uses Warning Amber, blocking/error uses Error Red, and neutral uses Muted Ink.
- Decorative status dots and emoji are not used. Map category markers remain the exception because their shape and legend identify spatial data rather than application status.

### Modal

- Observer, protection, and subscriber dialogs call the shared `DetailDialog` base. The base owns the sticky dossier header, flat summary band, section framing, continuous definition rows, close control, and responsive behavior; each dialog contributes only its facts and data-specific sections.
- Dialogs use a 16px radius, strong border, and the strongest system shadow over a 68% dark, blurred, desaturated scrim. Standard detail dialogs stop at 760px, subscriber dialogs at 840px, and data-rich observer dialogs at 920px.
- Headers use a 23px title, exact identifier or factual subtitle, and a 42px rounded-square icon-only Close control. Bodies have no generic inset: the summary band and each real section own their 18-24px padding and one-pixel separator.
- Summary facts are flat columns rather than boxed tiles. Protection details use label/value rows; subscriber connections form one continuous divided list; absent observer protection or neighbor data collapses into compact availability rows instead of empty sections.
- Dialogs share a stable, safe-area-aware top rail instead of shifting vertically with content height. On mobile they use 12px viewport gutters and a 16px radius on every corner; long dialogs scroll internally while short dialogs end naturally. Two- and four-fact summaries use two columns, three-fact summaries remain one compact row, and all summaries collapse to one column at 340px.
- Focus moves to Close, remains trapped, closes on Escape, and returns to the invoking control.

### Map Advert Selector

- Map results are 68px minimum-height rows with a 10px corner, category dot, exact name/region copy, and trailing metadata.
- Selected items use Relay Mint and Relay Ink with a Signal Green mixed border. Repeater, room, and sensor categories retain their fixed map hues.

## Do's and Don'ts

### Do:

- **Do** use Fog Surface for the page, Panel White for primary content, and Nested Fog for subordinate regions.
- **Do** keep Signal Green disciplined and pair every colored container with its matching foreground.
- **Do** preserve 44-48px interaction targets, visible keyboard focus, focus traps, Escape behavior, and reduced-motion handling.
- **Do** pair semantic color with explicit status text and preserve mobile `data-label` context.
- **Do** test every new surface and shadow in both light and dark themes, including the persisted override.
- **Do** let long keys, topics, and region names truncate or wrap without breaking layout.

### Don't:

- **Don't** introduce neon-on-black command-centre theatre, glowing gauges, radar cliches, or false urgency.
- **Don't** add arbitrary filled primary buttons; the incumbent action language is transparent, pill-shaped, and state-layer driven.
- **Don't** replace operational text with color, dots, icons, or hover-only disclosure.
- **Don't** add a new accent hue or surface tier when an existing semantic role already fits.
- **Don't** suppress the global focus ring unless an equally visible focus treatment replaces it.
- **Don't** turn identifiers and protocol data into decoration; monospace exists for exact reading, not a hacker aesthetic.
