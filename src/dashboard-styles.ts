export const DASHBOARD_STYLES = String.raw`
  :root {
    color-scheme: light;
    --md-sys-color-primary: #0b6b50;
    --md-sys-color-on-primary: #ffffff;
    --md-sys-color-primary-container: #9bf7d0;
    --md-sys-color-on-primary-container: #002117;
    --md-sys-color-secondary: #4c6358;
    --md-sys-color-on-secondary: #ffffff;
    --md-sys-color-secondary-container: #cee9da;
    --md-sys-color-on-secondary-container: #092017;
    --md-sys-color-tertiary: #3f6374;
    --md-sys-color-on-tertiary: #ffffff;
    --md-sys-color-tertiary-container: #c3e8fc;
    --md-sys-color-on-tertiary-container: #001f29;
    --md-sys-color-error: #ba1a1a;
    --md-sys-color-on-error: #ffffff;
    --md-sys-color-error-container: #ffdad6;
    --md-sys-color-on-error-container: #410002;
    --md-sys-color-warning: #875300;
    --md-sys-color-warning-container: #ffddb3;
    --md-sys-color-on-warning-container: #2b1700;
    --md-sys-color-surface: #f7fbf7;
    --md-sys-color-surface-dim: #d7dbd7;
    --md-sys-color-surface-bright: #f7fbf7;
    --md-sys-color-surface-container-lowest: #ffffff;
    --md-sys-color-surface-container-low: #f1f5f1;
    --md-sys-color-surface-container: #ebefeb;
    --md-sys-color-surface-container-high: #e5e9e5;
    --md-sys-color-surface-container-highest: #dfe3df;
    --md-sys-color-on-surface: #171d19;
    --md-sys-color-on-surface-variant: #404943;
    --md-sys-color-outline: #707973;
    --md-sys-color-outline-variant: #c0c9c1;
    --md-sys-color-inverse-surface: #2c322e;
    --md-sys-color-inverse-on-surface: #eef1ed;
    --md-sys-color-scrim: #000000;
    --md-sys-state-hover: rgba(23, 29, 25, 0.08);
    --md-sys-state-focus: rgba(23, 29, 25, 0.12);
    --md-sys-state-pressed: rgba(23, 29, 25, 0.12);
    --md-sys-shape-extra-small: 4px;
    --md-sys-shape-small: 8px;
    --md-sys-shape-medium: 12px;
    --md-sys-shape-large: 16px;
    --md-sys-shape-extra-large: 28px;
    --md-sys-shape-full: 999px;
    --md-sys-elevation-1: 0 1px 2px rgba(0, 0, 0, 0.18), 0 1px 3px 1px rgba(0, 0, 0, 0.08);
    --md-sys-elevation-2: 0 2px 6px 2px rgba(0, 0, 0, 0.10), 0 1px 2px rgba(0, 0, 0, 0.16);
    --md-sys-elevation-3: 0 4px 8px 3px rgba(0, 0, 0, 0.10), 0 1px 3px rgba(0, 0, 0, 0.16);
    --content-max: 1440px;
    --drawer-width: 280px;
    font-family: Roboto, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
  }

  *, *::before, *::after { box-sizing: border-box; }

  html { min-width: 320px; background: var(--md-sys-color-surface); }

  body {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  button, input, select { font: inherit; }
  button, a, input, select { -webkit-tap-highlight-color: transparent; }
  button { color: inherit; }
  a { color: inherit; }
  h1, h2, h3, p, dl, dd { margin: 0; }
  table { border-collapse: collapse; }
  code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }

  :focus-visible {
    outline: 3px solid color-mix(in srgb, var(--md-sys-color-primary) 70%, transparent);
    outline-offset: 2px;
  }

  .mdi { width: 24px; height: 24px; display: block; flex: none; }

  .app-shell { min-height: 100vh; }

  .navigation-drawer {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    width: var(--drawer-width);
    height: 100dvh;
    padding: 12px 12px 20px;
    display: flex;
    flex-direction: column;
    background: var(--md-sys-color-surface-container-low);
    color: var(--md-sys-color-on-surface-variant);
    overflow-y: auto;
  }

  .drawer-header {
    min-height: 72px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 8px;
  }

  .brand {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    color: var(--md-sys-color-on-surface);
  }

  .brand > svg { width: 40px; height: 40px; flex: none; }
  .brand > span { min-width: 0; display: grid; }
  .brand strong { font-size: 18px; line-height: 24px; font-weight: 700; letter-spacing: 0.1px; }
  .brand small { color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 16px; letter-spacing: 0.4px; }

  .nav-label {
    padding: 18px 16px 8px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .nav { display: grid; gap: 4px; }

  .nav-item {
    position: relative;
    min-height: 56px;
    padding: 0 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-radius: var(--md-sys-shape-full);
    color: var(--md-sys-color-on-surface-variant);
    text-decoration: none;
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    letter-spacing: 0.1px;
  }

  .nav-item::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: transparent;
    pointer-events: none;
  }

  .nav-item:hover::before { background: var(--md-sys-state-hover); }
  .nav-item:active::before { background: var(--md-sys-state-pressed); }
  .nav-item[aria-current="page"] {
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }
  .nav-item[aria-current="page"] .mdi { color: var(--md-sys-color-on-secondary-container); }

  .drawer-context {
    margin-top: auto;
    padding: 24px 16px 0;
    display: grid;
    gap: 14px;
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }

  .drawer-context div { min-width: 0; }
  .drawer-context dt {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 16px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .drawer-context dd {
    margin-top: 2px;
    overflow: hidden;
    color: var(--md-sys-color-on-surface);
    font-size: 13px;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-button.drawer-close { display: none; }
  .nav-scrim { display: none; }

  .app-frame {
    min-width: 0;
    min-height: 100vh;
    margin-left: var(--drawer-width);
  }

  .top-app-bar {
    position: sticky;
    top: 0;
    z-index: 25;
    min-height: 72px;
    padding: 0 clamp(24px, 3vw, 48px);
    display: flex;
    align-items: center;
    gap: 16px;
    background: color-mix(in srgb, var(--md-sys-color-surface) 92%, transparent);
    border-bottom: 1px solid transparent;
    backdrop-filter: blur(18px);
  }

  .topbar-title { min-width: 0; display: flex; align-items: center; gap: 12px; }
  .topbar-title > div { min-width: 0; display: grid; }
  .topbar-title strong {
    overflow: hidden;
    font-size: 18px;
    line-height: 24px;
    font-weight: 600;
    letter-spacing: 0.1px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .topbar-title span:not(.mobile-brand-mark) {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 12px;
    line-height: 16px;
    letter-spacing: 0.4px;
  }

  .mobile-brand-mark { display: none; }
  .mobile-brand-mark > svg { width: 36px; height: 36px; }
  .top-actions { margin-left: auto; }

  .snapshot-time {
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 10px;
    align-items: baseline;
    text-align: right;
  }
  .snapshot-time > span {
    grid-column: 1;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 16px;
    letter-spacing: 0.4px;
  }
  .snapshot-time strong {
    grid-column: 2;
    grid-row: 1 / span 2;
    color: var(--md-sys-color-on-surface);
    font-size: 20px;
    line-height: 24px;
    font-weight: 600;
    letter-spacing: 0;
  }
  .snapshot-time small {
    grid-column: 1;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 16px;
  }

  .icon-button {
    width: 48px;
    height: 48px;
    padding: 0;
    display: inline-grid;
    place-items: center;
    flex: none;
    border: 0;
    border-radius: var(--md-sys-shape-full);
    background: transparent;
    cursor: pointer;
  }
  .icon-button:hover { background: var(--md-sys-state-hover); }
  .icon-button:active { background: var(--md-sys-state-pressed); }
  .menu-button { display: none; }

  .main-content { min-width: 0; padding: 24px clamp(24px, 3vw, 48px) 64px; }
  .content-container { width: min(100%, var(--content-max)); margin: 0 auto; }

  .page-heading {
    min-height: 136px;
    padding: 20px 0 32px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 32px;
  }

  .page-heading > div { max-width: 760px; }
  .page-eyebrow {
    margin-bottom: 6px;
    color: var(--md-sys-color-primary);
    font-size: 12px;
    line-height: 16px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }
  .page-heading h1 {
    font-size: clamp(32px, 3vw, 45px);
    line-height: 1.12;
    font-weight: 500;
    letter-spacing: -0.6px;
  }
  .page-heading > div > p:last-child {
    margin-top: 10px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 16px;
    line-height: 24px;
    letter-spacing: 0.1px;
  }

  .page-context {
    min-width: 320px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
  }
  .page-context div { padding-left: 16px; border-left: 1px solid var(--md-sys-color-outline-variant); }
  .page-context dt {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 12px;
    line-height: 16px;
    letter-spacing: 0.4px;
  }
  .page-context dd {
    margin-top: 4px;
    overflow: hidden;
    color: var(--md-sys-color-on-surface);
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dashboard-notice {
    min-height: 72px;
    margin-bottom: 24px;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-radius: var(--md-sys-shape-large);
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }
  .dashboard-notice.error {
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
  }
  .dashboard-notice .mdi { width: 28px; height: 28px; }
  .dashboard-notice > div { display: grid; gap: 2px; }
  .dashboard-notice strong { font-size: 14px; line-height: 20px; font-weight: 700; }
  .dashboard-notice span { font-size: 14px; line-height: 20px; }

  .section-surface {
    min-width: 0;
    overflow: hidden;
    border-radius: var(--md-sys-shape-large);
    background: var(--md-sys-color-surface-container-lowest);
    box-shadow: var(--md-sys-elevation-1);
  }

  .section-header {
    min-height: 84px;
    padding: 22px 24px 16px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
  }
  .section-header h2 {
    color: var(--md-sys-color-on-surface);
    font-size: 20px;
    line-height: 28px;
    font-weight: 500;
    letter-spacing: 0;
  }
  .panel-subtitle {
    margin-top: 4px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 14px;
    line-height: 20px;
    letter-spacing: 0.1px;
  }
  .section-body { min-width: 0; overflow-x: auto; }
  .section-body > .empty { margin: 0 24px 24px; }

  .grid,
  .page-grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
    gap: 24px;
    align-items: start;
  }
  .grid { margin-top: 24px; }
  .span-2 { grid-column: 1 / -1; }

  .overview-lookup { margin-bottom: 24px; }
  .overview-lookup .section-body { padding: 0 24px 24px; overflow: visible; }

  .lookup-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
  }

  .lookup-input,
  .search input,
  .region-select {
    width: 100%;
    min-height: 56px;
    padding: 15px 16px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-sys-shape-extra-small);
    background: transparent;
    color: var(--md-sys-color-on-surface);
    font-size: 16px;
    line-height: 24px;
    letter-spacing: 0.5px;
  }
  .lookup-input::placeholder,
  .search input::placeholder { color: var(--md-sys-color-on-surface-variant); opacity: 1; }
  .lookup-input:hover,
  .search input:hover,
  .region-select:hover { border-color: var(--md-sys-color-on-surface); }
  .lookup-input:focus,
  .search input:focus,
  .region-select:focus {
    border: 2px solid var(--md-sys-color-primary);
    padding: 14px 15px;
    outline: 0;
  }
  .lookup-input:disabled { background: var(--md-sys-color-surface-container); color: var(--md-sys-color-outline); }

  .lookup-button,
  .panel-action-button,
  .lookup-detail-button {
    min-height: 48px;
    padding: 0 24px;
    border: 0;
    border-radius: var(--md-sys-shape-full);
    font-size: 14px;
    line-height: 20px;
    font-weight: 700;
    letter-spacing: 0.1px;
    cursor: pointer;
  }
  .lookup-button {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    box-shadow: var(--md-sys-elevation-1);
  }
  .lookup-button:hover { box-shadow: var(--md-sys-elevation-2); filter: brightness(0.98); }
  .lookup-button:disabled {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    box-shadow: none;
    cursor: default;
  }
  .panel-action-button,
  .lookup-detail-button {
    padding-inline: 16px;
    background: transparent;
    color: var(--md-sys-color-primary);
    box-shadow: none;
  }
  .panel-action-button:hover,
  .lookup-detail-button:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent); }
  .panel-actions,
  .feed-actions { padding: 12px 24px 20px; display: flex; justify-content: flex-end; }

  .lookup-result {
    margin-top: 20px;
    padding: 20px;
    border-radius: var(--md-sys-shape-medium);
    background: var(--md-sys-color-surface-container-low);
  }
  .lookup-result.known { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); }
  .lookup-result.blocked,
  .lookup-result.error { background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
  .lookup-result.invalid { background: var(--md-sys-color-warning-container); color: var(--md-sys-color-on-warning-container); }
  .lookup-result.unknown { background: var(--md-sys-color-surface-container); color: var(--md-sys-color-on-surface); }
  .lookup-result-header { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .lookup-message { margin-top: 8px; font-size: 14px; line-height: 20px; }

  .metrics {
    margin-bottom: 24px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: hidden;
    border-radius: var(--md-sys-shape-large);
    background: var(--md-sys-color-surface-container-lowest);
    box-shadow: var(--md-sys-elevation-1);
  }
  .metric-item {
    min-width: 0;
    min-height: 132px;
    padding: 24px;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 16px;
    align-items: center;
  }
  .metric-item + .metric-item { border-left: 1px solid var(--md-sys-color-outline-variant); }
  .metric-icon {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: var(--md-sys-shape-medium);
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
  }
  .metric-icon .mdi { width: 24px; height: 24px; }
  .metric-label {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    letter-spacing: 0.4px;
  }
  .metric-value {
    margin-top: 2px;
    color: var(--md-sys-color-on-surface);
    font-size: 32px;
    line-height: 40px;
    font-weight: 500;
    letter-spacing: -0.25px;
  }
  .metric-note {
    margin-top: 2px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 12px;
    line-height: 16px;
  }

  .filter-bar {
    padding: 0 24px 20px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(220px, 320px);
    gap: 12px;
  }
  .search { position: relative; display: block; }
  .search .mdi {
    position: absolute;
    top: 16px;
    left: 16px;
    width: 24px;
    height: 24px;
    color: var(--md-sys-color-on-surface-variant);
    pointer-events: none;
  }
  .search input { padding-left: 52px; }
  .search input:focus { padding-left: 51px; }
  .region-select { appearance: auto; }

  table { width: 100%; min-width: 720px; color: var(--md-sys-color-on-surface); font-size: 14px; line-height: 20px; }
  thead { background: var(--md-sys-color-surface-container-low); }
  th {
    height: 48px;
    padding: 0 16px;
    border-top: 1px solid var(--md-sys-color-outline-variant);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface-variant);
    text-align: left;
    font-size: 12px;
    line-height: 16px;
    font-weight: 700;
    letter-spacing: 0.35px;
    white-space: nowrap;
  }
  th:first-child, td:first-child { padding-left: 24px; }
  th:last-child, td:last-child { padding-right: 24px; }
  td {
    min-height: 56px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    vertical-align: middle;
  }
  tbody tr:last-child td { border-bottom: 0; }
  .click-row { position: relative; cursor: pointer; }
  @media (hover: hover) and (pointer: fine) {
    .click-row:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 6%, transparent); }
  }
  .click-row:focus { outline: 0; background: color-mix(in srgb, var(--md-sys-color-primary) 10%, transparent); }
  .click-row:focus-visible { box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--md-sys-color-primary) 55%, transparent); }
  .sort-button {
    min-height: 48px;
    margin: 0 -8px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: var(--md-sys-shape-small);
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: inherit;
    cursor: pointer;
  }
  .sort-button:hover { background: var(--md-sys-state-hover); }
  .sort-arrow { min-width: 12px; color: var(--md-sys-color-primary); font-size: 10px; text-align: center; }
  .primary-cell { min-width: 190px; font-weight: 600; }
  .wide-cell { min-width: 180px; }
  .topic-cell { max-width: 360px; overflow-wrap: anywhere; }
  .cell-value { min-width: 0; display: inline-flex; align-items: center; gap: 8px; }
  .region-cell .cell-value { display: grid; gap: 0; }
  .region-name { font-weight: 600; word-break: normal; overflow-wrap: normal; }
  .region-code { color: var(--md-sys-color-on-surface-variant); font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 0.4px; white-space: nowrap; }

  .status-dot {
    width: 8px;
    height: 8px;
    display: inline-block;
    flex: none;
    border-radius: 50%;
    background: var(--md-sys-color-outline);
  }
  .status-dot.green { background: #0a7d56; }
  .status-dot.yellow,
  .status-dot.warn { background: #a05d00; }
  .status-dot.red { background: var(--md-sys-color-error); }

  .status-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #075f45;
    font-size: 13px;
    line-height: 20px;
    font-weight: 700;
  }
  .status-label::before {
    content: "";
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: currentColor;
  }
  .status-label.orange { color: #875300; }
  .status-label.red { color: var(--md-sys-color-error); }
  .status-label.gray { color: var(--md-sys-color-on-surface-variant); }

  .distribution-list { padding: 0 24px 24px; display: grid; gap: 20px; }
  .distribution-item { display: grid; gap: 8px; }
  .distribution-label { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
  .distribution-name { min-width: 0; display: inline-flex; align-items: center; gap: 10px; font-size: 14px; line-height: 20px; font-weight: 600; }
  .distribution-value { display: inline-flex; align-items: baseline; gap: 8px; white-space: nowrap; }
  .distribution-value strong { font-size: 16px; line-height: 24px; }
  .distribution-value span { color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 16px; }
  .distribution-track {
    height: 8px;
    overflow: hidden;
    border-radius: var(--md-sys-shape-full);
    background: var(--md-sys-color-surface-container-highest);
  }
  .distribution-track > span {
    height: 100%;
    display: block;
    border-radius: inherit;
    background: var(--md-sys-color-primary);
  }
  .distribution-item:nth-child(2) .distribution-track > span { background: #397b8c; }
  .distribution-item:nth-child(3) .distribution-track > span { background: #596fa7; }
  .distribution-item:nth-child(4) .distribution-track > span { background: #8b5f86; }
  .distribution-summary {
    padding-top: 4px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 13px;
    line-height: 20px;
  }

  .publish-feed-wrap { min-width: 760px; }
  .publish-feed-head,
  .publish-row {
    display: grid;
    grid-template-columns: 76px minmax(280px, 2fr) minmax(170px, 1fr) minmax(120px, 0.75fr) 86px minmax(140px, 0.85fr);
    align-items: center;
    column-gap: 16px;
  }
  .publish-feed-head {
    min-height: 48px;
    padding: 0 24px;
    background: var(--md-sys-color-surface-container-low);
    border-top: 1px solid var(--md-sys-color-outline-variant);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 12px;
    line-height: 16px;
    font-weight: 700;
    letter-spacing: 0.35px;
  }
  .publish-row {
    min-height: 72px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    font-size: 13px;
    line-height: 18px;
  }
  .publish-row:last-child { border-bottom: 0; }
  .publish-row.new { animation: row-highlight 1.2s ease-out; }
  @keyframes row-highlight {
    from { background: color-mix(in srgb, var(--md-sys-color-primary-container) 65%, transparent); }
    to { background: transparent; }
  }
  .publish-time { color: var(--md-sys-color-primary); font-size: 15px; line-height: 20px; font-weight: 700; }
  .publish-main { min-width: 0; display: grid; gap: 2px; }
  .publish-main strong { overflow: hidden; font-size: 14px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
  .publish-main > span { overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-family: "SFMono-Regular", Consolas, monospace; font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
  .publish-region .cell-value { display: grid; gap: 0; }
  .publish-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .broker-reference-list { display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .broker-reference { display: inline-flex; color: var(--md-sys-color-on-surface-variant); }

  .empty {
    min-height: 132px;
    padding: 32px 24px;
    display: grid;
    place-items: center;
    color: var(--md-sys-color-on-surface-variant);
    text-align: center;
    font-size: 14px;
    line-height: 20px;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    padding: 32px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--md-sys-color-scrim) 42%, transparent);
    animation: scrim-in 140ms ease-out;
  }
  @keyframes scrim-in { from { opacity: 0; } to { opacity: 1; } }

  .modal {
    width: min(100%, 720px);
    max-height: calc(100dvh - 64px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border-radius: var(--md-sys-shape-extra-large);
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    box-shadow: var(--md-sys-elevation-3);
    animation: dialog-in 160ms cubic-bezier(0.2, 0, 0, 1);
  }
  @keyframes dialog-in {
    from { opacity: 0; transform: scale(0.98) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  .modal.sm { width: min(100%, 560px); }
  .modal.lg { width: min(100%, 900px); }
  .modal.wide { width: min(100%, 1120px); }
  .modal-header {
    min-height: 84px;
    padding: 18px 20px 14px 24px;
    display: flex;
    align-items: flex-start;
    gap: 16px;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }
  .modal-heading { min-width: 0; flex: 1; }
  .modal-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--md-sys-color-on-surface);
    font-size: 24px;
    line-height: 32px;
    font-weight: 500;
    letter-spacing: 0;
  }
  .modal-header .panel-subtitle { margin-top: 4px; }
  .modal-key {
    display: block;
    overflow-wrap: anywhere;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 12px;
    line-height: 18px;
  }
  .modal-body { min-height: 0; padding: 24px; overflow: auto; }
  .modal-body > section + section { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--md-sys-color-outline-variant); }
  .modal-body h3 {
    margin-bottom: 14px;
    color: var(--md-sys-color-on-surface);
    font-size: 16px;
    line-height: 24px;
    font-weight: 600;
  }
  .modal-body table { min-width: 680px; margin-inline: -24px; width: calc(100% + 48px); }

  .detail-grid,
  .detail-grid.compact {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-top: 1px solid var(--md-sys-color-outline-variant);
  }
  .detail-grid > div {
    min-width: 0;
    padding: 14px 16px;
    display: grid;
    gap: 4px;
    border-right: 1px solid var(--md-sys-color-outline-variant);
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }
  .detail-grid > div:nth-child(2n) { border-right: 0; }
  .detail-grid > .detail-wide { grid-column: 1 / -1; border-right: 0; }
  .detail-grid span,
  .detail-grid-dl dt {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 16px;
    font-weight: 600;
    letter-spacing: 0.45px;
    text-transform: uppercase;
  }
  .detail-grid strong,
  .detail-grid-dl dd {
    min-width: 0;
    color: var(--md-sys-color-on-surface);
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .detail-grid-dl {
    margin-top: 14px;
    display: grid;
    grid-template-columns: minmax(120px, 0.35fr) minmax(0, 1fr);
    border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  }
  .detail-grid-dl dt,
  .detail-grid-dl dd {
    padding: 12px 8px;
    border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  }

  @media (max-width: 1180px) {
    .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metric-item:nth-child(3) { border-left: 0; border-top: 1px solid var(--md-sys-color-outline-variant); }
    .metric-item:nth-child(4) { border-top: 1px solid var(--md-sys-color-outline-variant); }
    .page-context { min-width: 280px; }
  }

  @media (max-width: 1023px) {
    .navigation-drawer {
      z-index: 60;
      width: min(360px, calc(100vw - 48px));
      border-radius: 0 var(--md-sys-shape-extra-large) var(--md-sys-shape-extra-large) 0;
      box-shadow: var(--md-sys-elevation-3);
      transform: translateX(-105%);
      visibility: hidden;
      transition: transform 220ms cubic-bezier(0.2, 0, 0, 1), visibility 0s linear 220ms;
    }
    .navigation-drawer.open {
      transform: translateX(0);
      visibility: visible;
      transition: transform 220ms cubic-bezier(0.2, 0, 0, 1);
    }
    .icon-button.drawer-close { display: inline-grid; }
    .nav-scrim {
      position: fixed;
      inset: 0;
      z-index: 55;
      display: block;
      border: 0;
      background: color-mix(in srgb, var(--md-sys-color-scrim) 38%, transparent);
      cursor: default;
    }
    .app-frame { margin-left: 0; }
    .menu-button { display: inline-grid; }
    .grid,
    .page-grid { grid-template-columns: 1fr; }
    .span-2 { grid-column: auto; }
    .page-context { display: none; }
  }

  @media (max-width: 720px) {
    body { font-size: 15px; }
    .top-app-bar {
      position: relative;
      top: auto;
      min-height: 64px;
      padding: 0 8px 0 4px;
      background: var(--md-sys-color-surface);
      border-bottom-color: var(--md-sys-color-outline-variant);
      backdrop-filter: none;
    }
    .topbar-title { gap: 8px; }
    .topbar-title strong { font-size: 16px; line-height: 22px; }
    .topbar-title span:not(.mobile-brand-mark) { display: none; }
    .mobile-brand-mark { display: block; }
    .mobile-brand-mark > svg { width: 32px; height: 32px; }
    .snapshot-time { display: grid; grid-template-columns: auto; text-align: right; }
    .snapshot-time > span,
    .snapshot-time small { display: none; }
    .snapshot-time strong { grid-column: 1; grid-row: 1; font-size: 16px; line-height: 22px; }

    .main-content { padding: 0 12px 40px; }
    .page-heading {
      min-height: 0;
      padding: 24px 4px 20px;
      display: block;
    }
    .page-eyebrow { margin-bottom: 4px; font-size: 11px; }
    .page-heading h1 { font-size: 30px; line-height: 36px; letter-spacing: -0.35px; }
    .page-heading > div > p:last-child { margin-top: 8px; font-size: 14px; line-height: 20px; }

    .dashboard-notice { margin-bottom: 16px; padding: 12px 16px; border-radius: var(--md-sys-shape-medium); }
    .dashboard-notice .mdi { width: 24px; height: 24px; }

    .overview-lookup { margin-bottom: 16px; }
    .section-surface { border-radius: var(--md-sys-shape-large); box-shadow: none; }
    .section-header { min-height: 0; padding: 20px 16px 12px; }
    .section-header h2 { font-size: 19px; line-height: 26px; }
    .panel-subtitle { font-size: 13px; line-height: 19px; }
    .overview-lookup .section-body { padding: 0 16px 20px; }
    .grid,
    .page-grid { gap: 16px; }
    .grid { margin-top: 16px; }

    .lookup-form { grid-template-columns: 1fr; }
    .lookup-button { width: max-content; min-width: 132px; }
    .lookup-result { padding: 16px; }
    .lookup-result-header { align-items: flex-start; }

    .metrics {
      margin-bottom: 16px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      border-radius: var(--md-sys-shape-large);
      box-shadow: none;
    }
    .metric-item {
      min-height: 148px;
      padding: 18px 16px;
      grid-template-columns: 1fr;
      gap: 12px;
      align-content: start;
    }
    .metric-item:nth-child(3) { border-left: 0; border-top: 1px solid var(--md-sys-color-outline-variant); }
    .metric-item:nth-child(4) { border-top: 1px solid var(--md-sys-color-outline-variant); }
    .metric-icon { width: 40px; height: 40px; }
    .metric-value { font-size: 30px; line-height: 36px; }

    .filter-bar { padding: 0 16px 16px; grid-template-columns: 1fr; }
    .distribution-list { padding: 0 16px 20px; gap: 18px; }

    .section-body { overflow-x: visible; }
    table { min-width: 0; display: block; font-size: 14px; }
    thead {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    tbody { display: block; }
    tbody tr {
      position: relative;
      min-width: 0;
      padding: 16px 44px 16px 16px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 20px;
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
    }
    tbody tr:last-child { border-bottom: 0; }
    .click-row::after {
      content: "›";
      position: absolute;
      top: 18px;
      right: 18px;
      color: var(--md-sys-color-on-surface-variant);
      font-size: 24px;
      line-height: 24px;
      font-weight: 300;
    }
    tbody td,
    th:first-child,
    td:first-child,
    th:last-child,
    td:last-child {
      min-width: 0;
      min-height: 0;
      padding: 0;
      display: block;
      border: 0;
    }
    tbody td::before {
      content: attr(data-label);
      margin-bottom: 3px;
      display: block;
      color: var(--md-sys-color-on-surface-variant);
      font-size: 10px;
      line-height: 14px;
      font-weight: 700;
      letter-spacing: 0.45px;
      text-transform: uppercase;
    }
    tbody td.primary-cell { grid-column: 1 / -1; font-size: 15px; line-height: 22px; }
    tbody td.primary-cell::before { display: none; }
    tbody td.wide-cell,
    tbody td.topic-cell { grid-column: 1 / -1; }
    .cell-value { align-items: flex-start; }
    .region-cell .cell-value { display: grid; }

    .publish-feed-wrap { min-width: 0; }
    .publish-feed-head { display: none; }
    .publish-row {
      min-height: 0;
      padding: 16px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px 16px;
      align-items: start;
    }
    .publish-time { grid-column: 1; grid-row: 1; font-size: 14px; }
    .publish-main { grid-column: 2; grid-row: 1; }
    .publish-main strong { font-size: 14px; }
    .publish-main > span { margin-top: 2px; font-size: 11px; white-space: normal; overflow-wrap: anywhere; }
    .publish-region,
    .publish-meta {
      grid-column: 2;
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(92px, 0.45fr) minmax(0, 1fr);
      gap: 10px;
      overflow: visible;
      white-space: normal;
    }
    .publish-region::before,
    .publish-meta::before {
      content: attr(data-label);
      color: var(--md-sys-color-on-surface-variant);
      font-size: 10px;
      line-height: 16px;
      font-weight: 700;
      letter-spacing: 0.45px;
      text-transform: uppercase;
    }
    .publish-region .cell-value { display: grid; }
    .feed-actions,
    .panel-actions { padding: 8px 12px 16px; }

    .modal-backdrop { padding: 0; place-items: stretch; }
    .modal,
    .modal.sm,
    .modal.lg,
    .modal.wide {
      width: 100%;
      max-height: 100dvh;
      min-height: 100dvh;
      border-radius: 0;
      background: var(--md-sys-color-surface);
      box-shadow: none;
      animation: mobile-dialog-in 180ms cubic-bezier(0.2, 0, 0, 1);
    }
    @keyframes mobile-dialog-in {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .modal-header {
      position: sticky;
      top: 0;
      z-index: 2;
      min-height: 72px;
      padding: 12px 8px 10px 20px;
      align-items: center;
      background: var(--md-sys-color-surface);
    }
    .modal-title { font-size: 20px; line-height: 28px; }
    .modal-header .panel-subtitle {
      max-width: calc(100vw - 92px);
      overflow: hidden;
      font-size: 11px;
      line-height: 16px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .modal-body { padding: 20px 16px 32px; }
    .modal-body table { min-width: 0; width: calc(100% + 32px); margin-inline: -16px; }
    .modal-backdrop.sm {
      padding: 16px;
      place-items: center;
    }
    .modal.sm {
      width: min(100%, 560px);
      min-height: auto;
      max-height: calc(100dvh - 32px);
      border-radius: var(--md-sys-shape-extra-large);
      background: var(--md-sys-color-surface-container-high);
      box-shadow: var(--md-sys-elevation-3);
    }
    .modal.sm .modal-header {
      position: relative;
      background: transparent;
    }
    .detail-grid,
    .detail-grid.compact { grid-template-columns: 1fr; }
    .detail-grid > div,
    .detail-grid > div:nth-child(2n) { padding: 14px 0; border-right: 0; }
    .detail-grid-dl { grid-template-columns: 1fr; }
    .detail-grid-dl dt { padding-bottom: 2px; border-bottom: 0; }
    .detail-grid-dl dd { padding-top: 0; }
  }

  @media (max-width: 420px) {
    .navigation-drawer { width: calc(100vw - 32px); }
    .lookup-result-header { display: grid; }
    .lookup-detail-button { justify-self: start; margin-left: -16px; }
    tbody tr { grid-template-columns: 1fr; }
    tbody td.primary-cell,
    tbody td.wide-cell,
    tbody td.topic-cell { grid-column: 1; }
  }

  @media (max-width: 340px) {
    .metrics { grid-template-columns: 1fr; }
    .metric-item {
      min-height: 112px;
      grid-template-columns: 40px minmax(0, 1fr);
      align-items: center;
    }
    .metric-item + .metric-item,
    .metric-item:nth-child(3),
    .metric-item:nth-child(4) {
      border-left: 0;
      border-top: 1px solid var(--md-sys-color-outline-variant);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      scroll-behavior: auto !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;
