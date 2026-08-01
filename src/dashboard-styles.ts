export const DASHBOARD_STYLES = String.raw`
  :root {
    color-scheme: light;
    --md-sys-color-primary: #006c4c;
    --md-sys-color-on-primary: #ffffff;
    --md-sys-color-primary-container: #86f8c8;
    --md-sys-color-on-primary-container: #002116;
    --md-sys-color-secondary: #48665a;
    --md-sys-color-on-secondary: #ffffff;
    --md-sys-color-secondary-container: #cbead9;
    --md-sys-color-on-secondary-container: #052018;
    --md-sys-color-tertiary: #3d6472;
    --md-sys-color-on-tertiary: #ffffff;
    --md-sys-color-tertiary-container: #c1e9fa;
    --md-sys-color-on-tertiary-container: #001f29;
    --md-sys-color-error: #ba1a1a;
    --md-sys-color-on-error: #ffffff;
    --md-sys-color-error-container: #ffdad6;
    --md-sys-color-on-error-container: #410002;
    --md-sys-color-warning: #805600;
    --md-sys-color-warning-container: #ffdea6;
    --md-sys-color-on-warning-container: #291800;
    --md-sys-color-success: #006c4c;
    --md-sys-color-surface: #f6f9f6;
    --md-sys-color-surface-container-lowest: #ffffff;
    --md-sys-color-surface-container-low: #eff4f0;
    --md-sys-color-surface-container: #e9eeea;
    --md-sys-color-surface-container-high: #e3e9e4;
    --md-sys-color-surface-container-highest: #dde3de;
    --md-sys-color-on-surface: #171d19;
    --md-sys-color-on-surface-variant: #414943;
    --md-sys-color-outline: #717972;
    --md-sys-color-outline-variant: #c1c9c2;
    --md-sys-color-scrim: #000000;
    --surface-border: rgba(70, 82, 74, 0.16);
    --surface-border-strong: rgba(70, 82, 74, 0.24);
    --state-hover: rgba(23, 29, 25, 0.06);
    --state-pressed: rgba(23, 29, 25, 0.11);
    --focus-ring: rgba(0, 108, 76, 0.42);
    --shadow-card: 0 1px 2px rgba(21, 31, 25, 0.05), 0 8px 24px rgba(21, 31, 25, 0.045);
    --shadow-compact: 0 1px 2px rgba(21, 31, 25, 0.035);
    --shadow-popover: 0 16px 42px rgba(13, 24, 18, 0.16), 0 3px 10px rgba(13, 24, 18, 0.1);
    --shadow-dialog: 0 20px 60px rgba(13, 24, 18, 0.25), 0 4px 16px rgba(13, 24, 18, 0.18);
    --mono-font: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    --shape-xs: 6px;
    --shape-sm: 10px;
    --shape-md: 14px;
    --shape-lg: 18px;
    --shape-xl: 24px;
    --shape-full: 999px;
    --drawer-width: 248px;
    --content-max: 1320px;
    font-family: Aptos, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
  }

  :root[data-theme="dark"] {
    color-scheme: dark;
    --md-sys-color-primary: #69dba9;
    --md-sys-color-on-primary: #003826;
    --md-sys-color-primary-container: #005139;
    --md-sys-color-on-primary-container: #86f8c8;
    --md-sys-color-secondary: #afd0bf;
    --md-sys-color-on-secondary: #1a352b;
    --md-sys-color-secondary-container: #314c40;
    --md-sys-color-on-secondary-container: #cbead9;
    --md-sys-color-tertiary: #a5cdda;
    --md-sys-color-on-tertiary: #073542;
    --md-sys-color-tertiary-container: #244c59;
    --md-sys-color-on-tertiary-container: #c1e9fa;
    --md-sys-color-error: #ffb4ab;
    --md-sys-color-on-error: #690005;
    --md-sys-color-error-container: #93000a;
    --md-sys-color-on-error-container: #ffdad6;
    --md-sys-color-warning: #f5bd63;
    --md-sys-color-warning-container: #5f3f00;
    --md-sys-color-on-warning-container: #ffdea6;
    --md-sys-color-success: #69dba9;
    --md-sys-color-surface: #101512;
    --md-sys-color-surface-container-lowest: #0b0f0d;
    --md-sys-color-surface-container-low: #171c18;
    --md-sys-color-surface-container: #1b211d;
    --md-sys-color-surface-container-high: #262c27;
    --md-sys-color-surface-container-highest: #313732;
    --md-sys-color-on-surface: #e0e4df;
    --md-sys-color-on-surface-variant: #c1c9c2;
    --md-sys-color-outline: #8b938c;
    --md-sys-color-outline-variant: #414943;
    --surface-border: rgba(193, 201, 194, 0.15);
    --surface-border-strong: rgba(193, 201, 194, 0.24);
    --state-hover: rgba(224, 228, 223, 0.07);
    --state-pressed: rgba(224, 228, 223, 0.12);
    --focus-ring: rgba(105, 219, 169, 0.48);
    --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.34), 0 8px 28px rgba(0, 0, 0, 0.2);
    --shadow-compact: 0 1px 2px rgba(0, 0, 0, 0.28);
    --shadow-popover: 0 18px 48px rgba(0, 0, 0, 0.5), 0 3px 12px rgba(0, 0, 0, 0.34);
    --shadow-dialog: 0 20px 60px rgba(0, 0, 0, 0.55), 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  *, *::before, *::after { box-sizing: border-box; }

  html {
    min-width: 320px;
    background: var(--md-sys-color-surface);
    scrollbar-gutter: stable;
  }

  body {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  button, input, select { font: inherit; }
  button, a, input, select { -webkit-tap-highlight-color: transparent; }
  button { color: inherit; }
  a { color: inherit; }
  h1, h2, h3, p, dl, dd { margin: 0; }
  table { border-collapse: collapse; }
  code { font-family: var(--mono-font); }

  :focus-visible {
    outline: 3px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .skip-link {
    position: fixed;
    z-index: 200;
    top: max(10px, env(safe-area-inset-top));
    left: max(12px, env(safe-area-inset-left));
    min-height: 44px;
    padding: 0 16px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--shape-full);
    background: var(--md-sys-color-on-surface);
    color: var(--md-sys-color-surface);
    box-shadow: var(--shadow-dialog);
    font-size: 12px;
    line-height: 18px;
    font-weight: 720;
    text-decoration: none;
    transform: translateY(calc(-100% - 24px));
    transition: transform 140ms ease-out;
  }

  .skip-link:focus-visible { transform: translateY(0); }
  .main-content:focus { outline: none; }

  .mdi {
    width: 22px;
    height: 22px;
    display: block;
    flex: none;
  }

  .app-shell,
  .app-frame { min-height: 100vh; }

  .navigation-drawer {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    width: var(--drawer-width);
    height: 100dvh;
    padding:
      max(12px, env(safe-area-inset-top))
      12px
      max(20px, env(safe-area-inset-bottom))
      max(12px, env(safe-area-inset-left));
    display: flex;
    flex-direction: column;
    background: var(--md-sys-color-surface-container-low);
    border-right: 1px solid var(--surface-border);
    color: var(--md-sys-color-on-surface-variant);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .drawer-header {
    min-height: 64px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .brand {
    min-width: 0;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 11px;
    color: var(--md-sys-color-on-surface);
    text-decoration: none;
  }

  .brand > svg {
    width: 38px;
    height: 38px;
    flex: none;
    filter: drop-shadow(0 2px 5px rgba(0, 108, 76, 0.13));
  }

  .brand > span {
    min-width: 0;
    display: grid;
  }

  .brand strong {
    font-size: 17px;
    line-height: 22px;
    font-weight: 720;
    letter-spacing: -0.15px;
  }

  .brand small {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 16px;
    letter-spacing: 0.2px;
  }

  .nav {
    margin-top: 18px;
    display: grid;
    gap: 3px;
  }

  .nav-item {
    position: relative;
    min-height: 48px;
    padding: 0 14px;
    display: flex;
    align-items: center;
    gap: 13px;
    border-radius: var(--shape-full);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 13px;
    line-height: 20px;
    font-weight: 640;
    letter-spacing: 0.05px;
    text-decoration: none;
    transition: background-color 140ms ease, color 140ms ease, transform 140ms ease;
  }

  .nav-item .mdi { width: 20px; height: 20px; }

  .nav-item[aria-current="page"] {
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }

  .drawer-close,
  .nav-scrim,
  .menu-button { display: none; }

  .app-frame {
    min-width: 0;
    margin-left: var(--drawer-width);
  }

  .top-app-bar {
    position: sticky;
    top: 0;
    z-index: 25;
    min-height: 64px;
    padding: 0 clamp(24px, 3vw, 44px);
    display: flex;
    align-items: center;
    gap: 14px;
    background: color-mix(in srgb, var(--md-sys-color-surface) 90%, transparent);
    border-bottom: 1px solid var(--surface-border);
    backdrop-filter: blur(18px) saturate(130%);
  }

  .topbar-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 11px;
  }

  .topbar-title > div {
    min-width: 0;
    display: grid;
  }

  .topbar-title strong {
    overflow: hidden;
    font-size: 14px;
    line-height: 20px;
    font-weight: 700;
    letter-spacing: -0.05px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .topbar-title > div > span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 16px;
  }

  .mobile-brand-mark,
  .mobile-title { display: none; }

  .top-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .theme-toggle {
    min-width: 76px;
    min-height: 42px;
    padding: 0 13px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid var(--surface-border-strong);
    border-radius: var(--shape-full);
    background: var(--md-sys-color-surface-container-low);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
  }

  .theme-toggle .mdi { width: 17px; height: 17px; }

  .snapshot-time {
    min-width: 158px;
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 10px;
    align-items: center;
    text-align: right;
  }

  .snapshot-labels {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .snapshot-time span,
  .snapshot-time small {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 14px;
    letter-spacing: 0.25px;
  }

  .snapshot-time strong {
    grid-column: 2;
    color: var(--md-sys-color-on-surface);
    font-size: 19px;
    line-height: 23px;
    font-weight: 720;
    letter-spacing: -0.35px;
  }

  .icon-button {
    width: 46px;
    height: 46px;
    padding: 0;
    display: inline-grid;
    place-items: center;
    flex: none;
    border: 0;
    border-radius: var(--shape-full);
    background: transparent;
    cursor: pointer;
    transition: background-color 140ms ease, transform 140ms ease;
  }

  .icon-button.drawer-close,
  .icon-button.menu-button { display: none; }

  .main-content {
    min-width: 0;
    padding: 22px clamp(24px, 3vw, 44px) max(64px, env(safe-area-inset-bottom));
  }

  .content-container {
    width: min(100%, var(--content-max));
    margin: 0 auto;
  }

  .page-heading {
    padding: 26px 2px 24px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 32px;
  }

  .page-heading > div {
    min-width: 0;
    max-width: 760px;
  }

  .page-heading h1 {
    font-size: clamp(31px, 3.2vw, 43px);
    line-height: 1.1;
    font-weight: 610;
    letter-spacing: -1.1px;
  }

  .page-heading > div > p:last-child {
    margin-top: 8px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 15px;
    line-height: 23px;
  }

  .dashboard-notice {
    margin-bottom: 16px;
    padding: 14px 16px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-md);
    background: var(--md-sys-color-surface-container-lowest);
    color: var(--md-sys-color-on-surface);
  }

  .dashboard-notice > .mdi { margin-top: 1px; color: var(--md-sys-color-primary); }
  .dashboard-notice > div { min-width: 0; display: grid; gap: 2px; }
  .dashboard-notice strong { font-size: 13px; line-height: 19px; }
  .dashboard-notice span { color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 18px; }
  .dashboard-notice.error {
    border-color: color-mix(in srgb, var(--md-sys-color-error) 36%, var(--surface-border));
    background: color-mix(in srgb, var(--md-sys-color-error-container) 54%, var(--md-sys-color-surface-container-lowest));
  }
  .dashboard-notice.error > .mdi { color: var(--md-sys-color-error); }

  .dashboard-notice.loading {
    border-color: color-mix(in srgb, var(--md-sys-color-primary) 24%, var(--surface-border));
    background: color-mix(in srgb, var(--md-sys-color-primary-container) 22%, var(--md-sys-color-surface-container-lowest));
  }

  .dashboard-notice.loading > .mdi { animation: loading-pulse 1.4s ease-in-out infinite; }

  @keyframes loading-pulse {
    0%, 100% { opacity: 0.55; transform: scale(0.92); }
    50% { opacity: 1; transform: scale(1); }
  }

  .section-surface {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-lg);
    background: var(--md-sys-color-surface-container-lowest);
    box-shadow: var(--shadow-card);
  }

  .section-header {
    padding: 21px 22px 17px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .section-header > div { min-width: 0; }

  .section-header h2 {
    font-size: 17px;
    line-height: 23px;
    font-weight: 710;
    letter-spacing: -0.25px;
  }

  .panel-subtitle {
    margin-top: 3px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 12px;
    line-height: 18px;
  }

  .section-body {
    min-width: 0;
    overflow-x: auto;
  }

  .empty {
    margin: 0 22px 22px;
    padding: 12px 0;
    display: grid;
    place-items: start;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 13px;
    line-height: 20px;
    text-align: left;
  }

  .metrics {
    margin-bottom: 16px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-md);
    background: var(--surface-border);
  }

  .metrics.overview-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }

  .metric-item {
    min-width: 0;
    min-height: 126px;
    padding: 18px;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    align-items: start;
    gap: 13px;
    overflow: hidden;
    border: 0;
    border-radius: 0;
    background: var(--md-sys-color-surface-container-lowest);
  }

  .metric-icon {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 13px;
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
  }

  .metric-icon .mdi { width: 21px; height: 21px; }

  .metric-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .metric-label {
    min-height: 18px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 15px;
    font-weight: 720;
    letter-spacing: 0.15px;
  }

  .metric-value {
    margin-top: 2px;
    max-width: 100%;
    color: var(--md-sys-color-on-surface);
    font-size: clamp(24px, 2.2vw, 31px);
    line-height: 1.1;
    font-weight: 650;
    letter-spacing: -0.75px;
    overflow-wrap: anywhere;
  }

  .metric-value.textual {
    margin-top: 5px;
    font-size: clamp(15px, 1.4vw, 19px);
    line-height: 1.25;
    letter-spacing: -0.2px;
  }

  .metric-note {
    margin-top: auto;
    padding-top: 5px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 15px;
    overflow-wrap: anywhere;
  }

  .grid,
  .page-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.72fr);
    gap: 16px;
  }

  .grid > .span-2,
  .page-grid > .span-2 { grid-column: 1 / -1; }

  .page-grid.two { grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.75fr); }

  .overview-lookup {
    position: relative;
    z-index: 20;
    margin-bottom: 16px;
    overflow: visible;
  }

  .overview-lookup .section-body { overflow: visible; }

  .lookup-form {
    padding: 0 22px 22px;
  }

  .lookup-field {
    position: relative;
    z-index: 2;
    max-width: 720px;
  }

  .lookup-field.open .lookup-input {
    border-color: var(--md-sys-color-primary);
    border-radius: var(--shape-sm) var(--shape-sm) 0 0;
    box-shadow: 0 0 0 1px var(--md-sys-color-primary);
  }

  .lookup-results {
    position: absolute;
    z-index: 30;
    top: calc(100% - 1px);
    left: 0;
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--surface-border-strong);
    border-top: 0;
    border-radius: 0 0 var(--shape-sm) var(--shape-sm);
    background: var(--md-sys-color-surface-container-lowest);
    box-shadow: var(--shadow-popover);
    transform-origin: top center;
    animation: popover-in 140ms cubic-bezier(0.2, 0, 0, 1);
  }

  @keyframes popover-in {
    from { opacity: 0; transform: translateY(-3px) scaleY(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .lookup-results-header {
    min-height: 42px;
    padding: 8px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid var(--surface-border);
    background: var(--md-sys-color-surface-container-low);
  }

  .lookup-results-header strong {
    color: var(--md-sys-color-on-surface);
    font-size: 11px;
    line-height: 16px;
    font-weight: 720;
  }

  .lookup-results-header span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
  }

  .lookup-results-list {
    max-height: min(338px, calc(50vh - 42px));
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .lookup-result-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 12px 16px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--md-sys-color-on-surface);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background-color 120ms ease;
  }

  .lookup-result-row:not(:last-child) {
    border-bottom: 1px solid var(--surface-border);
  }

  .lookup-result-row:hover { background: var(--state-hover); }

  .lookup-result-row:focus-visible {
    background: var(--state-hover);
    outline: 2px solid var(--md-sys-color-primary);
    outline-offset: -3px;
  }

  .lookup-result-label {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lookup-result-region {
    grid-column: 2;
    grid-row: 1;
  }

  .lookup-result-key {
    grid-column: 1;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    font-family: var(--mono-font);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lookup-no-results {
    padding: 24px 16px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 13px;
    line-height: 20px;
    text-align: center;
  }

  .field {
    min-width: 0;
    display: grid;
    gap: 6px;
  }

  .field-label {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 16px;
    font-weight: 680;
  }

  input,
  select {
    width: 100%;
    min-width: 0;
    height: 48px;
    padding: 0 14px;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--shape-sm);
    background: var(--md-sys-color-surface-container-lowest);
    color: var(--md-sys-color-on-surface);
    transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
  }

  input::placeholder { color: color-mix(in srgb, var(--md-sys-color-on-surface-variant) 72%, transparent); }

  input:focus,
  select:focus {
    border-color: var(--md-sys-color-primary);
    box-shadow: 0 0 0 1px var(--md-sys-color-primary);
    outline: none;
  }

  select {
    padding-right: 42px;
    appearance: none;
    background-image:
      linear-gradient(45deg, transparent 50%, var(--md-sys-color-on-surface-variant) 50%),
      linear-gradient(135deg, var(--md-sys-color-on-surface-variant) 50%, transparent 50%);
    background-position:
      calc(100% - 18px) 20px,
      calc(100% - 13px) 20px;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
  }

  .panel-action-button {
    min-height: 44px;
    padding: 0 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--shape-full);
    font-size: 12px;
    line-height: 18px;
    font-weight: 720;
    letter-spacing: 0.1px;
    cursor: pointer;
    text-decoration: none;
    background: transparent;
    color: var(--md-sys-color-primary);
    transition: background-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .filter-bar {
    padding: 0 22px 20px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(210px, 0.34fr);
    gap: 12px;
  }

  .field.search { position: relative; }
  .field.search .mdi {
    position: absolute;
    left: 14px;
    bottom: 13px;
    width: 20px;
    height: 20px;
    color: var(--md-sys-color-on-surface-variant);
    pointer-events: none;
  }
  .field.search input { padding-left: 44px; }

  table {
    width: 100%;
    min-width: 680px;
    color: var(--md-sys-color-on-surface);
    font-size: 12px;
    line-height: 18px;
  }

  thead { background: var(--md-sys-color-surface-container-low); }

  th,
  td {
    min-width: 0;
    padding: 13px 14px;
    border-top: 1px solid var(--surface-border);
    text-align: left;
    vertical-align: middle;
  }

  th {
    height: 44px;
    padding-top: 0;
    padding-bottom: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 15px;
    font-weight: 720;
    letter-spacing: 0.18px;
    white-space: nowrap;
  }

  td {
    height: 56px;
    overflow-wrap: anywhere;
  }

  td.primary-cell { min-width: 220px; }
  td.wide-cell { min-width: 180px; }
  td.topic-cell { max-width: 420px; }

  .sort-button {
    width: 100%;
    min-height: 46px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  .sort-arrow {
    width: 7px;
    height: 7px;
    display: inline-block;
    flex: none;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    color: var(--md-sys-color-primary);
    transform: translateY(-1px) rotate(45deg);
    transition: transform 120ms ease, opacity 120ms ease;
  }

  .sort-arrow.asc { transform: translateY(2px) rotate(225deg); }
  .sort-arrow.inactive { opacity: 0.4; }

  .click-row {
    position: relative;
    cursor: pointer;
    transition: background-color 120ms ease;
  }

  .primary-stack {
    min-width: 0;
    display: grid;
    gap: 3px;
  }

  .cell-value {
    min-width: 0;
    color: var(--md-sys-color-on-surface);
    font-weight: 650;
    overflow-wrap: anywhere;
  }

  .cell-note {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 15px;
  }

  .status-label {
    width: fit-content;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    color: var(--md-sys-color-success);
    font-size: 10px;
    line-height: 15px;
    font-weight: 720;
    white-space: normal;
  }

  .status-label.orange { color: var(--md-sys-color-warning); }
  .status-label.red { color: var(--md-sys-color-error); }
  .status-label.gray { color: var(--md-sys-color-on-surface-variant); }

  .region-name {
    display: block;
    color: var(--md-sys-color-on-surface);
    font-weight: 630;
    overflow-wrap: normal;
    word-break: normal;
  }

  .region-code {
    display: block;
    margin-top: 2px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 9px;
    line-height: 13px;
    font-weight: 760;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .topic-code {
    display: block;
    max-width: 100%;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .meshcoreio-panel .section-body { overflow: visible; }

  .meshcoreio-metrics {
    margin: 0 22px 20px;
  }

  .meshcoreio-metrics .metric-item {
    min-height: 118px;
    background: var(--md-sys-color-surface-container-low);
  }

  .meshcoreio-heading {
    margin: 25px 22px 10px;
    font-size: 14px;
    line-height: 20px;
    font-weight: 720;
    letter-spacing: -0.1px;
  }

  .meshcoreio-panel .dashboard-notice { margin: 0 22px 20px; }

  .meshcoreio-compact-actions { padding-top: 0; }

  .meshcoreio-map-section {
    margin: 0 22px 24px;
    overflow: hidden;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-lg);
    background: var(--md-sys-color-surface-container-lowest);
    box-shadow: var(--shadow-card);
  }

  .meshcoreio-map-heading {
    min-height: 78px;
    padding: 17px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    border-bottom: 1px solid var(--surface-border);
  }

  .meshcoreio-map-heading > div { min-width: 0; }

  .meshcoreio-map-heading h3 {
    font-size: 15px;
    line-height: 21px;
    font-weight: 740;
    letter-spacing: -0.15px;
  }

  .meshcoreio-map-heading p {
    max-width: 720px;
    margin-top: 3px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 17px;
  }

  .meshcoreio-map-count {
    min-height: 32px;
    padding: 6px 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border-radius: var(--shape-full);
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    font-size: 11px;
    line-height: 18px;
    font-weight: 720;
    white-space: nowrap;
  }

  .meshcoreio-map-layout {
    min-height: 486px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(268px, 32%);
  }

  .meshcoreio-map-column {
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--surface-border);
    background: var(--md-sys-color-surface-container-low);
  }

  .meshcoreio-map-frame {
    position: relative;
    min-height: 414px;
    flex: 1;
    overflow: hidden;
    background: var(--md-sys-color-surface-container-high);
  }

  .meshcoreio-map-canvas {
    position: absolute;
    inset: 0;
  }

  .meshcoreio-map-canvas .maplibregl-map,
  .meshcoreio-map-canvas .maplibregl-canvas-container,
  .meshcoreio-map-canvas .maplibregl-canvas {
    width: 100%;
    height: 100%;
  }

  .meshcoreio-map-canvas .maplibregl-ctrl-group {
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.45);
    border-radius: var(--shape-sm);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
  }

  .meshcoreio-map-canvas .maplibregl-ctrl-group button {
    width: 44px;
    height: 44px;
  }

  .meshcoreio-map-canvas .maplibregl-ctrl-attrib {
    color: #303733;
    font-size: 9px;
  }

  .meshcoreio-map-fallback {
    position: absolute;
    inset: 0;
    z-index: 2;
    padding: 28px;
    display: grid;
    place-items: center;
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface-variant);
    text-align: center;
    font-size: 12px;
    line-height: 19px;
  }

  .meshcoreio-map-fit {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 3;
    min-height: 44px;
    padding: 0 13px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid rgba(255, 255, 255, 0.56);
    border-radius: var(--shape-full);
    background: rgba(18, 27, 22, 0.88);
    color: #f4faf6;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.22);
    backdrop-filter: blur(8px);
    cursor: pointer;
    font-size: 11px;
    line-height: 18px;
    font-weight: 720;
  }

  .meshcoreio-map-fit .mdi {
    width: 18px;
    height: 18px;
  }

  .meshcoreio-map-legend {
    position: absolute;
    left: 12px;
    bottom: 12px;
    z-index: 3;
    min-height: 34px;
    padding: 6px 9px;
    display: flex;
    align-items: center;
    gap: 11px;
    border: 1px solid rgba(255, 255, 255, 0.42);
    border-radius: var(--shape-sm);
    background: rgba(18, 27, 22, 0.86);
    color: #f4faf6;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(8px);
    font-size: 9px;
    line-height: 15px;
  }

  .meshcoreio-map-legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }

  .meshcoreio-map-legend i,
  .meshcoreio-map-dot {
    width: 9px;
    height: 9px;
    display: block;
    flex: none;
    border-radius: 50%;
    background: #5e6d64;
  }

  .meshcoreio-map-legend i.repeater,
  .meshcoreio-map-dot.repeater { background: #087f5b; }
  .meshcoreio-map-legend i.room,
  .meshcoreio-map-dot.room { background: #2f6f89; }
  .meshcoreio-map-legend i.sensor,
  .meshcoreio-map-dot.sensor { background: #a15c00; }

  .meshcoreio-map-selection {
    min-height: 72px;
    padding: 12px 15px;
    display: flex;
    align-items: center;
    gap: 11px;
    border-top: 1px solid var(--surface-border);
    background: var(--md-sys-color-surface-container-lowest);
  }

  .meshcoreio-map-selection-icon {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    flex: none;
    border-radius: 12px;
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
  }

  .meshcoreio-map-selection-icon .mdi {
    width: 21px;
    height: 21px;
  }

  .meshcoreio-map-selection > div:last-child {
    min-width: 0;
    display: grid;
    gap: 1px;
  }

  .meshcoreio-map-selection strong {
    overflow: hidden;
    font-size: 12px;
    line-height: 18px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meshcoreio-map-selection span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
    overflow-wrap: anywhere;
  }

  .meshcoreio-map-list {
    max-height: 486px;
    padding: 8px;
    display: grid;
    align-content: start;
    gap: 6px;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--md-sys-color-surface-container-lowest);
  }

  .meshcoreio-map-item {
    width: 100%;
    min-height: 68px;
    padding: 10px;
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    border: 1px solid transparent;
    border-radius: var(--shape-sm);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .meshcoreio-map-item.selected {
    border-color: color-mix(in srgb, var(--md-sys-color-primary) 38%, transparent);
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
  }

  .meshcoreio-map-item-copy,
  .meshcoreio-map-item-meta {
    min-width: 0;
    display: grid;
    gap: 1px;
  }

  .meshcoreio-map-item-copy strong,
  .meshcoreio-map-item-meta strong {
    font-size: 11px;
    line-height: 17px;
    font-weight: 720;
  }

  .meshcoreio-map-item-copy strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meshcoreio-map-item-copy span,
  .meshcoreio-map-item-meta span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 9px;
    line-height: 15px;
  }

  .meshcoreio-map-item.selected .meshcoreio-map-item-copy span,
  .meshcoreio-map-item.selected .meshcoreio-map-item-meta span {
    color: inherit;
    opacity: 0.75;
  }

  .meshcoreio-map-item-meta {
    justify-items: end;
    text-align: right;
    white-space: nowrap;
  }

  .neighbor-snapshot {
    min-width: 0;
    display: grid;
    gap: 14px;
  }

  .neighbor-key {
    color: inherit;
    font-size: 11px;
    line-height: 17px;
    font-weight: 680;
    overflow-wrap: anywhere;
  }

  .scope-list {
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .neighbor-table td:nth-child(2),
  .neighbor-table td:nth-child(3) {
    white-space: nowrap;
  }

  .panel-actions,
  .feed-actions {
    padding: 10px 22px 18px;
    display: flex;
    justify-content: flex-end;
  }

  .publish-feed-wrap { min-width: 0; }

  .publish-feed-head,
  .publish-row {
    min-width: 920px;
    display: grid;
    grid-template-columns:
      62px
      minmax(240px, 1.7fr)
      minmax(150px, 0.9fr)
      minmax(120px, 0.72fr)
      80px;
    gap: 14px;
    align-items: center;
  }

  .publish-feed-head {
    min-height: 44px;
    padding: 0 14px;
    border-top: 1px solid var(--surface-border);
    background: var(--md-sys-color-surface-container-low);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 15px;
    font-weight: 720;
  }

  .publish-feed { min-width: 920px; }

  .publish-row {
    min-height: 66px;
    padding: 10px 14px;
    border-top: 1px solid var(--surface-border);
    font-size: 11px;
    line-height: 17px;
  }

  .publish-row.new { animation: publish-highlight 1.2s ease-out; }

  @keyframes publish-highlight {
    from { background: color-mix(in srgb, var(--md-sys-color-primary-container) 55%, transparent); }
    to { background: transparent; }
  }

  .publish-time {
    color: var(--md-sys-color-primary);
    font-weight: 760;
  }

  .publish-main {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .publish-main strong {
    overflow: hidden;
    color: var(--md-sys-color-on-surface);
    font-size: 11px;
    line-height: 17px;
    font-weight: 690;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .publish-topic {
    min-width: 0;
    overflow: hidden;
    color: var(--md-sys-color-on-surface-variant);
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 9px;
    line-height: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .publish-region,
  .publish-meta { min-width: 0; }
  .publish-meta { overflow-wrap: anywhere; }

  .broker-reference-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px 7px;
  }

  .broker-reference {
    padding: 3px 7px;
    border-radius: var(--shape-full);
    background: var(--md-sys-color-surface-container-low);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
    overflow-wrap: anywhere;
  }

  .subscriber-table { min-width: 980px; }

  .subscription-list {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 6px;
  }

  .subscription-topic {
    max-width: 100%;
    padding: 4px 8px;
    display: inline-block;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-xs);
    background: var(--md-sys-color-surface-container-low);
    color: var(--md-sys-color-on-surface);
    font-size: 10px;
    line-height: 16px;
    font-weight: 560;
    overflow-wrap: anywhere;
  }

  .subscription-empty {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
  }

  .subscription-more {
    padding: 4px 8px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--shape-full);
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 9px;
    line-height: 16px;
    font-weight: 680;
  }

  .subscriber-connection-list {
    border-top: 1px solid var(--surface-border);
  }

  .subscriber-connection {
    min-width: 0;
    padding: 14px 0;
    display: grid;
    gap: 10px;
    border-bottom: 1px solid var(--surface-border);
  }

  .subscriber-connection > header {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .subscriber-connection > header strong {
    color: var(--md-sys-color-on-surface);
    font-size: 12px;
    line-height: 18px;
    overflow-wrap: anywhere;
  }

  .subscriber-connection > header span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
  }

  .subscriber-connection > header > span { white-space: nowrap; }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    padding: max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom));
    display: grid;
    place-items: center;
    background: rgba(3, 10, 6, 0.68);
    backdrop-filter: blur(10px) saturate(72%);
    animation: backdrop-in 140ms ease-out;
  }

  @keyframes backdrop-in { from { opacity: 0; } to { opacity: 1; } }

  .modal {
    width: min(100%, 760px);
    max-height: min(90dvh, 940px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--surface-border-strong);
    border-radius: 16px;
    background: var(--md-sys-color-surface-container-lowest);
    box-shadow: var(--shadow-dialog);
    animation: dialog-in 160ms ease-out;
  }

  .modal.sm { width: min(100%, 620px); }
  .modal.lg { width: min(100%, 840px); }
  .modal.wide { width: min(100%, 920px); }

  @keyframes dialog-in {
    from { opacity: 0; transform: translateY(8px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-header {
    position: sticky;
    top: 0;
    z-index: 2;
    min-height: 88px;
    padding: 20px 20px 18px 24px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid var(--surface-border);
    background: color-mix(in srgb, var(--md-sys-color-surface-container-lowest) 97%, transparent);
    backdrop-filter: blur(18px);
  }

  .modal-heading {
    width: 0;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    flex: 1 1 auto;
  }

  .modal-heading > * {
    min-width: 0;
    max-width: 100%;
  }

  .modal-title {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--md-sys-color-on-surface);
    font-size: 23px;
    line-height: 29px;
    font-weight: 740;
    letter-spacing: -0.55px;
    overflow-wrap: anywhere;
  }

  .modal-key {
    width: 100%;
    display: block;
    max-width: min(100%, 680px);
    margin-top: 5px;
    overflow: hidden;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 9px;
    line-height: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .modal-close {
    width: 42px;
    height: 42px;
    padding: 0;
    display: inline-grid;
    align-items: center;
    justify-content: center;
    flex: none;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-sm);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
  }

  .modal-close .mdi { width: 20px; height: 20px; }

  .modal-body {
    min-height: 0;
    padding: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .modal-body > section:not(.modal-summary) {
    padding: 20px 24px 22px;
  }

  .modal-body > section:not(.modal-summary) + section {
    border-top: 1px solid var(--surface-border);
  }

  .modal-summary {
    padding: 18px 24px 19px;
    border-bottom: 1px solid var(--surface-border);
    background: var(--md-sys-color-surface-container-low);
  }

  .modal-facts {
    display: grid;
    gap: 0;
  }

  .modal-facts.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .modal-facts.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .modal-facts.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }

  .modal-facts > div {
    min-width: 0;
    padding: 1px 18px;
  }

  .modal-facts > div:first-child { padding-left: 0; }
  .modal-facts > div + div { border-left: 1px solid var(--surface-border); }
  .modal-facts > div:last-child { padding-right: 0; }

  .modal-facts dt,
  .modal-record dt {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 9px;
    line-height: 14px;
    font-weight: 720;
    letter-spacing: 0.35px;
  }

  .modal-facts dd {
    min-width: 0;
    margin-top: 5px;
    color: var(--md-sys-color-on-surface);
    font-size: 13px;
    line-height: 19px;
    font-weight: 680;
    overflow-wrap: anywhere;
  }

  .modal-facts .modal-fact-note {
    margin-top: 2px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 9px;
    line-height: 14px;
    font-weight: 500;
  }

  .modal-fact-detail { font-size: 11px; line-height: 17px; }

  .modal-section-heading {
    min-width: 0;
    margin-bottom: 13px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }

  .modal-section-heading h3 {
    font-size: 15px;
    line-height: 21px;
    font-weight: 740;
    letter-spacing: -0.15px;
  }

  .modal-section-meta {
    flex: none;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
  }

  .modal-record {
    margin: 0;
    border-top: 1px solid var(--surface-border);
  }

  .modal-record > div {
    min-width: 0;
    padding: 11px 0;
    display: grid;
    grid-template-columns: minmax(120px, 0.28fr) minmax(0, 1fr);
    gap: 18px;
    border-bottom: 1px solid var(--surface-border);
  }

  .modal-record dd {
    min-width: 0;
    color: var(--md-sys-color-on-surface);
    font-size: 12px;
    line-height: 18px;
    font-weight: 640;
    overflow-wrap: anywhere;
  }

  .modal-record.compact { margin-top: -2px; }

  .modal-availability {
    padding: 0 24px;
    border-bottom: 1px solid var(--surface-border);
  }

  .modal-availability > div {
    min-width: 0;
    min-height: 58px;
    padding: 10px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }

  .modal-availability > div + div { border-top: 1px solid var(--surface-border); }

  .modal-availability-copy {
    min-width: 0;
    display: grid;
    gap: 1px;
    flex: 1;
  }

  .modal-availability-copy strong {
    font-size: 11px;
    line-height: 17px;
    font-weight: 700;
  }

  .modal-availability-copy > span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
  }

  .modal-availability code { white-space: nowrap; }

  .neighbor-snapshot > .modal-facts {
    padding-bottom: 15px;
    border-bottom: 1px solid var(--surface-border);
  }

  .modal-body .empty {
    margin: 0;
    padding: 8px 0;
  }
  .modal-body table { border: 1px solid var(--surface-border); border-radius: var(--shape-md); border-collapse: separate; border-spacing: 0; overflow: hidden; }
  .modal-body table th:first-child { border-top-left-radius: var(--shape-md); }
  .modal-body table th:last-child { border-top-right-radius: var(--shape-md); }

  @media (hover: hover) and (pointer: fine) {
    .nav-item:hover,
    .icon-button:hover,
    .panel-action-button:hover,
    .theme-toggle:hover { background: var(--state-hover); }
    .modal-close:hover {
      border-color: var(--surface-border-strong);
      background: var(--state-hover);
      color: var(--md-sys-color-on-surface);
    }
    .nav-item:hover { color: var(--md-sys-color-on-surface); }
    .click-row:hover { background: var(--state-hover); }
    .sort-button:hover { color: var(--md-sys-color-on-surface); }
    .meshcoreio-map-item:not(.selected):hover { background: var(--state-hover); }
    .meshcoreio-map-fit:hover { background: rgba(28, 42, 34, 0.96); }
  }

  .nav-item:active,
  .icon-button:active,
  .panel-action-button:active,
  .theme-toggle:active { background: var(--state-pressed); }
  .modal-close:active { background: var(--state-pressed); }

  @media (max-width: 1120px) {
    :root { --drawer-width: 224px; }
    .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metrics.overview-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metrics.overview-metrics .metric-item:last-child:nth-child(odd) {
      grid-column: 1 / -1;
    }
    .metric-item { min-height: 116px; }
    .grid,
    .page-grid,
    .page-grid.two { grid-template-columns: 1fr; }
    .grid > .span-2,
    .page-grid > .span-2 { grid-column: 1; }
  }

  @media (max-width: 920px) {
    .navigation-drawer {
      width: min(320px, calc(100vw - 52px));
      max-width: 100%;
      padding-right: 12px;
      border-right: 1px solid var(--surface-border-strong);
      box-shadow: 14px 0 42px rgba(0, 0, 0, 0.18);
      transform: translateX(-105%);
      visibility: hidden;
      transition: transform 190ms ease, visibility 190ms linear;
    }

    .navigation-drawer.open {
      transform: translateX(0);
      visibility: visible;
    }

    .icon-button.drawer-close,
    .icon-button.menu-button { display: inline-grid; }

    .nav-scrim {
      position: fixed;
      inset: 0;
      z-index: 35;
      display: block;
      border: 0;
      background: rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(2px);
    }

    .app-frame { margin-left: 0; }
    .top-app-bar { padding-inline: max(12px, env(safe-area-inset-left)) max(16px, env(safe-area-inset-right)); }
    .mobile-brand-mark { display: inline-flex; }
    .mobile-brand-mark > svg { width: 32px; height: 32px; }
    .main-content { padding-inline: 20px; }

    .meshcoreio-map-layout { grid-template-columns: 1fr; }
    .meshcoreio-map-column {
      border-right: 0;
      border-bottom: 1px solid var(--surface-border);
    }
    .meshcoreio-map-list {
      max-height: 310px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 800px) {
    body { font-size: 14px; }
    .top-app-bar { min-height: 60px; }
    .topbar-title > div > span { display: none; }
    .desktop-title { display: none; }
    .mobile-title { display: inline; }
    .snapshot-time {
      min-width: auto;
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
    }
    .snapshot-labels { display: flex; }
    .snapshot-time small { display: none; }
    .snapshot-time strong {
      grid-column: 1;
      font-size: 14px;
      line-height: 20px;
    }
    .top-actions { gap: 8px; }
    .theme-toggle {
      width: 42px;
      min-width: 42px;
      height: 42px;
      padding: 0;
    }
    .theme-toggle span { display: none; }

    .main-content {
      padding: 14px 14px max(44px, env(safe-area-inset-bottom));
    }

    .page-heading {
      min-height: 108px;
      padding: 12px 2px 20px;
      align-items: flex-start;
    }

    .page-heading h1 {
      font-size: 28px;
      line-height: 34px;
      letter-spacing: -0.7px;
    }

    .page-heading > div > p:last-child {
      margin-top: 5px;
      font-size: 13px;
      line-height: 20px;
    }

    .section-surface {
      border-radius: var(--shape-md);
      box-shadow: var(--shadow-compact);
    }

    .section-header { padding: 17px 16px 13px; }
    .section-header h2 { font-size: 16px; line-height: 22px; }
    .panel-subtitle { font-size: 11px; line-height: 17px; }

    .metrics {
      margin-bottom: 12px;
      gap: 1px;
    }

    .metric-item {
      min-height: 126px;
      padding: 15px;
      grid-template-columns: 38px minmax(0, 1fr);
      gap: 10px;
    }

    .metric-icon { width: 38px; height: 38px; border-radius: 12px; }
    .metric-value { font-size: 26px; }
    .metric-value.textual { font-size: 15px; line-height: 19px; }

    .grid,
    .page-grid,
    .page-grid.two { gap: 12px; }

    .overview-lookup { margin-bottom: 12px; }

    .lookup-form {
      padding: 0 16px 16px;
    }

    .filter-bar {
      padding: 0 16px 16px;
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .section-body { overflow-x: visible; }

    table,
    .publish-feed,
    .publish-feed-head,
    .publish-row { min-width: 0; }

    table { display: block; width: 100%; font-size: 12px; }
    .subscriber-table { min-width: 0; }
    thead { display: none; }
    tbody {
      padding: 0 10px 10px;
      display: grid;
      gap: 9px;
    }

    tbody tr {
      min-width: 0;
      padding: 14px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 14px;
      border: 1px solid var(--surface-border);
      border-radius: var(--shape-sm);
      background: var(--md-sys-color-surface-container-low);
    }

    tbody td {
      width: auto;
      min-width: 0;
      height: auto;
      padding: 0;
      display: block;
      border: 0;
      font-size: 11px;
      line-height: 17px;
      overflow-wrap: anywhere;
    }

    tbody td::before {
      content: attr(data-label);
      margin-bottom: 2px;
      display: block;
      color: var(--md-sys-color-on-surface-variant);
      font-size: 8px;
      line-height: 12px;
      font-weight: 780;
      letter-spacing: 0.65px;
      text-transform: uppercase;
    }

    tbody td.primary-cell,
    tbody td.wide-cell,
    tbody td.topic-cell { grid-column: 1 / -1; }

    tbody td.primary-cell::before { display: none; }
    .primary-cell .cell-value { font-size: 12px; line-height: 18px; }

    .click-row { padding-right: 38px; }
    .click-row::after {
      content: "";
      position: absolute;
      top: 17px;
      right: 17px;
      width: 7px;
      height: 7px;
      border-top: 1.5px solid currentColor;
      border-right: 1.5px solid currentColor;
      color: var(--md-sys-color-on-surface-variant);
      transform: rotate(45deg);
    }

    .meshcoreio-metrics {
      margin: 0 10px 16px;
    }

    .meshcoreio-heading { margin: 21px 16px 9px; }
    .meshcoreio-panel .dashboard-notice { margin: 0 10px 16px; }
    .meshcoreio-map-section { margin: 0 10px 18px; }
    .meshcoreio-map-heading { min-height: 72px; padding: 14px; }
    .meshcoreio-map-frame { min-height: 370px; }
    .meshcoreio-map-layout { min-height: 0; }

    .panel-actions,
    .feed-actions { padding: 8px 16px 14px; }

    .publish-feed-head { display: none; }
    .publish-feed {
      padding: 0 10px 10px;
      display: grid;
      gap: 9px;
    }

    .publish-row {
      min-height: 0;
      padding: 13px;
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr);
      gap: 9px 12px;
      align-items: start;
      border: 1px solid var(--surface-border);
      border-radius: var(--shape-sm);
      background: var(--md-sys-color-surface-container-low);
    }

    .publish-time {
      grid-row: 1 / span 4;
      padding-top: 1px;
      font-size: 11px;
    }

    .publish-main {
      grid-column: 2;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--surface-border);
    }

    .publish-main strong {
      font-size: 12px;
      line-height: 18px;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .publish-topic {
      display: -webkit-box;
      font-size: 9px;
      line-height: 14px;
      white-space: normal;
      overflow-wrap: anywhere;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .publish-region,
    .publish-meta {
      grid-column: 2;
      display: grid;
      grid-template-columns: minmax(78px, 0.42fr) minmax(0, 1fr);
      gap: 8px;
      font-size: 10px;
      line-height: 16px;
    }

    .publish-region::before,
    .publish-meta::before {
      content: attr(data-label);
      color: var(--md-sys-color-on-surface-variant);
      font-size: 8px;
      line-height: 13px;
      font-weight: 780;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }

    .publish-region .cell-value { font-size: 10px; line-height: 16px; }
    .publish-region .region-code { font-size: 8px; line-height: 12px; }

    .modal-backdrop {
      padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom));
      place-items: end center;
    }

    .modal,
    .modal.sm,
    .modal.lg,
    .modal.wide {
      width: 100%;
      max-height: calc(100dvh - max(24px, env(safe-area-inset-top)));
      border-radius: 16px 16px 8px 8px;
    }

    .modal-header { min-height: 80px; padding: 18px 14px 15px 18px; }
    .modal-title { font-size: 20px; line-height: 26px; }
    .modal-summary { padding: 16px 18px 17px; }
    .modal-body > section:not(.modal-summary) { padding: 18px; }
    .modal-availability { padding-inline: 18px; }

    .modal-facts.two,
    .modal-facts.three,
    .modal-facts.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }

    .modal-facts > div {
      padding: 0 12px;
    }

    .modal-facts > div:nth-child(odd) {
      padding-left: 0;
      border-left: 0;
    }

    .modal-facts > div:nth-child(even) { padding-right: 0; }

    .modal-facts > div:nth-child(n + 3) {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--surface-border);
    }

    .modal-facts.three > div:last-child:nth-child(odd) {
      grid-column: 1 / -1;
      padding-right: 0;
    }

    .modal-body table {
      display: block;
      border: 0;
      border-radius: 0;
    }

    .modal-body tbody { padding: 0; }
    .modal-body tbody tr { background: var(--md-sys-color-surface-container-low); }

  }

  @media (max-width: 460px) {
    .modal-record > div {
      grid-template-columns: 1fr;
      gap: 3px;
    }

    .subscriber-connection > header {
      align-items: flex-start;
      flex-direction: column;
      gap: 3px;
    }

    .topbar-title { gap: 8px; }
    .mobile-brand-mark > svg { width: 28px; height: 28px; }
    .topbar-title strong { font-size: 13px; }
    .menu-button { width: 46px; height: 46px; }

    .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metric-item {
      min-height: 132px;
      padding: 13px;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 9px;
    }
    .metric-icon { width: 34px; height: 34px; border-radius: 10px; }
    .metric-icon .mdi { width: 18px; height: 18px; }
    .metric-label { font-size: 9px; line-height: 14px; }
    .metric-value { font-size: 24px; }
    .metric-note { font-size: 9px; line-height: 14px; }

    .meshcoreio-map-heading {
      align-items: flex-start;
      flex-direction: column;
      gap: 10px;
    }
    .meshcoreio-map-count { align-self: flex-start; }
    .meshcoreio-map-frame { min-height: 320px; }
    .meshcoreio-map-list {
      max-height: 330px;
      grid-template-columns: 1fr;
    }
    .meshcoreio-map-item { min-height: 64px; }
    .meshcoreio-map-legend {
      right: 10px;
      left: 10px;
      justify-content: center;
      gap: 9px;
    }
    .meshcoreio-map-selection { align-items: flex-start; }
    .meshcoreio-map-selection strong {
      text-overflow: clip;
      white-space: normal;
      overflow-wrap: anywhere;
    }

  }

  @media (max-width: 340px) {
    .modal-facts.two,
    .modal-facts.three,
    .modal-facts.four { grid-template-columns: 1fr; }

    .modal-facts > div,
    .modal-facts > div:nth-child(even),
    .modal-facts > div:nth-child(odd) {
      padding-inline: 0;
      border-left: 0;
    }

    .modal-facts > div + div {
      margin-top: 11px;
      padding-top: 11px;
      border-top: 1px solid var(--surface-border);
    }

    .modal-facts.three > div:last-child:nth-child(odd) { grid-column: 1; }

    .modal-availability > div {
      align-items: flex-start;
      flex-direction: column;
      gap: 5px;
    }

    .metrics { grid-template-columns: 1fr; }
    .metrics.overview-metrics { grid-template-columns: 1fr; }
    .metric-item { min-height: 105px; }
    tbody tr { grid-template-columns: 1fr; }
    tbody td.primary-cell,
    tbody td.wide-cell,
    tbody td.topic-cell { grid-column: 1; }
    .mobile-title { display: none; }
    .meshcoreio-map-fit { padding-inline: 11px; }
    .meshcoreio-map-fit .mdi { margin-right: 0; }
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
