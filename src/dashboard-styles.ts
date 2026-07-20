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
    --shadow-dialog: 0 20px 60px rgba(13, 24, 18, 0.25), 0 4px 16px rgba(13, 24, 18, 0.18);
    --shape-xs: 6px;
    --shape-sm: 10px;
    --shape-md: 14px;
    --shape-lg: 18px;
    --shape-xl: 24px;
    --shape-full: 999px;
    --drawer-width: 248px;
    --content-max: 1320px;
    font-family: Inter, Roboto, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
  }

  @media (prefers-color-scheme: dark) {
    :root {
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
      --shadow-dialog: 0 20px 60px rgba(0, 0, 0, 0.55), 0 4px 16px rgba(0, 0, 0, 0.35);
    }
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
  code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }

  :focus-visible {
    outline: 3px solid var(--focus-ring);
    outline-offset: 2px;
  }

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

  .nav-label {
    padding: 20px 14px 8px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
    font-weight: 750;
    letter-spacing: 0.9px;
    text-transform: uppercase;
  }

  .nav {
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

  .drawer-context {
    margin-top: auto;
    padding: 20px 14px 2px;
    display: grid;
    gap: 14px;
    border-top: 1px solid var(--surface-border);
  }

  .drawer-context div { min-width: 0; }

  .drawer-context dt {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 15px;
    font-weight: 750;
    letter-spacing: 0.75px;
    text-transform: uppercase;
  }

  .drawer-context dd {
    margin-top: 3px;
    overflow: hidden;
    color: var(--md-sys-color-on-surface);
    font-size: 12px;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .top-actions { margin-left: auto; }

  .snapshot-time {
    min-width: 158px;
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 10px;
    align-items: baseline;
    text-align: right;
  }

  .snapshot-time > span,
  .snapshot-time small {
    grid-column: 1;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 14px;
    letter-spacing: 0.25px;
  }

  .snapshot-time strong {
    grid-column: 2;
    grid-row: 1 / span 2;
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
    min-height: 132px;
    padding: 16px 2px 28px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 32px;
  }

  .page-heading > div {
    min-width: 0;
    max-width: 760px;
  }

  .page-eyebrow {
    margin-bottom: 5px;
    color: var(--md-sys-color-primary);
    font-size: 11px;
    line-height: 16px;
    font-weight: 780;
    letter-spacing: 0.85px;
    text-transform: uppercase;
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

  .page-context {
    min-width: 286px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .page-context div {
    min-width: 0;
    padding: 11px 13px;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-sm);
    background: color-mix(in srgb, var(--md-sys-color-surface-container-lowest) 66%, transparent);
  }

  .page-context dt {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 15px;
    font-weight: 650;
  }

  .page-context dd {
    margin-top: 3px;
    overflow: hidden;
    color: var(--md-sys-color-on-surface);
    font-size: 13px;
    line-height: 18px;
    font-weight: 690;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    padding: 30px 20px;
    display: grid;
    place-items: center;
    border: 1px dashed var(--surface-border-strong);
    border-radius: var(--shape-md);
    background: var(--md-sys-color-surface-container-low);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 13px;
    line-height: 20px;
    text-align: center;
  }

  .metrics {
    margin-bottom: 16px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .metric-item {
    min-width: 0;
    min-height: 126px;
    padding: 18px;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    align-items: start;
    gap: 13px;
    overflow: hidden;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-md);
    background: var(--md-sys-color-surface-container-lowest);
    box-shadow: 0 1px 2px rgba(21, 31, 25, 0.035);
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

  .overview-lookup { margin-bottom: 16px; }

  .lookup-form {
    padding: 0 22px 22px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 12px;
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

  .lookup-button,
  .panel-action-button,
  .lookup-detail-button {
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
    transition: background-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .lookup-button {
    min-width: 118px;
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    box-shadow: 0 2px 5px rgba(0, 108, 76, 0.18);
  }

  .lookup-button:disabled {
    background: var(--md-sys-color-surface-container-highest);
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    box-shadow: none;
    cursor: default;
  }

  .panel-action-button,
  .lookup-detail-button {
    background: transparent;
    color: var(--md-sys-color-primary);
  }

  .lookup-result {
    margin: 0 22px 22px;
    padding: 16px;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-md);
    background: var(--md-sys-color-surface-container-low);
  }

  .lookup-result.known {
    border-color: color-mix(in srgb, var(--md-sys-color-success) 28%, var(--surface-border));
    background: color-mix(in srgb, var(--md-sys-color-primary-container) 22%, var(--md-sys-color-surface-container-lowest));
  }

  .lookup-result.blocked,
  .lookup-result.error {
    border-color: color-mix(in srgb, var(--md-sys-color-error) 30%, var(--surface-border));
    background: color-mix(in srgb, var(--md-sys-color-error-container) 38%, var(--md-sys-color-surface-container-lowest));
  }

  .lookup-result.invalid {
    border-color: color-mix(in srgb, var(--md-sys-color-warning) 32%, var(--surface-border));
    background: color-mix(in srgb, var(--md-sys-color-warning-container) 35%, var(--md-sys-color-surface-container-lowest));
  }

  .lookup-result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .lookup-detail-button { margin: -8px -8px -8px auto; }

  .lookup-message {
    margin-top: 10px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 13px;
    line-height: 20px;
  }

  .detail-grid-dl {
    margin-top: 14px;
    display: grid;
    grid-template-columns: minmax(120px, 0.34fr) minmax(0, 1fr);
    border-top: 1px solid var(--surface-border);
  }

  .detail-grid-dl dt,
  .detail-grid-dl dd {
    min-width: 0;
    padding: 10px 0;
    border-bottom: 1px solid var(--surface-border);
  }

  .detail-grid-dl dt {
    padding-right: 16px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    line-height: 18px;
    font-weight: 650;
  }

  .detail-grid-dl dd {
    color: var(--md-sys-color-on-surface);
    font-size: 12px;
    line-height: 18px;
    font-weight: 620;
    overflow-wrap: anywhere;
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
    color: var(--md-sys-color-primary);
    font-size: 9px;
    line-height: 1;
  }

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
    gap: 6px;
    color: var(--md-sys-color-success);
    font-size: 10px;
    line-height: 15px;
    font-weight: 720;
    white-space: normal;
  }

  .status-label::before {
    content: "";
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: currentColor;
  }

  .status-label.orange { color: var(--md-sys-color-warning); }
  .status-label.red { color: var(--md-sys-color-error); }
  .status-label.gray { color: var(--md-sys-color-on-surface-variant); }

  .status-dot {
    width: 9px;
    height: 9px;
    display: inline-block;
    flex: none;
    border-radius: 50%;
    background: var(--md-sys-color-success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-sys-color-success) 14%, transparent);
  }

  .status-dot.yellow,
  .status-dot.warn { background: var(--md-sys-color-warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-sys-color-warning) 14%, transparent); }
  .status-dot.red { background: var(--md-sys-color-error); box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-sys-color-error) 14%, transparent); }

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

  .distribution-list {
    padding: 0 22px 22px;
    display: grid;
    gap: 18px;
  }

  .distribution-item { min-width: 0; }

  .distribution-label {
    margin-bottom: 7px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .distribution-copy {
    min-width: 0;
    display: grid;
    gap: 3px;
  }

  .distribution-name {
    color: var(--md-sys-color-on-surface);
    font-size: 12px;
    line-height: 17px;
    font-weight: 680;
    overflow-wrap: anywhere;
  }

  .distribution-value {
    display: flex;
    align-items: baseline;
    gap: 7px;
    flex: none;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 15px;
  }

  .distribution-value strong {
    color: var(--md-sys-color-on-surface);
    font-size: 12px;
  }

  .distribution-track {
    height: 7px;
    overflow: hidden;
    border-radius: var(--shape-full);
    background: var(--md-sys-color-surface-container-highest);
  }

  .distribution-track > span {
    height: 100%;
    display: block;
    border-radius: inherit;
    background: var(--md-sys-color-primary);
    transition: width 220ms ease;
  }

  .distribution-summary {
    padding-top: 14px;
    border-top: 1px solid var(--surface-border);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
  }

  .meshcoreio-panel .section-body { overflow: visible; }

  .meshcoreio-metrics {
    margin: 0 22px 20px;
  }

  .meshcoreio-metrics .metric-item {
    min-height: 118px;
    background: var(--md-sys-color-surface-container-low);
    box-shadow: none;
  }

  .meshcoreio-panel .section-body > .detail-grid {
    margin: 0 22px 22px;
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

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-md);
    background: var(--surface-border);
  }

  .detail-grid.compact { grid-template-columns: repeat(2, minmax(0, 1fr)); }

  .detail-grid > div {
    min-width: 0;
    min-height: 78px;
    padding: 14px 16px;
    display: grid;
    align-content: center;
    gap: 4px;
    background: var(--md-sys-color-surface-container-lowest);
  }

  .detail-grid > .detail-wide { grid-column: 1 / -1; }

  .detail-grid > div > span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 15px;
    font-weight: 650;
  }

  .detail-grid > div > strong,
  .detail-grid > div > code {
    min-width: 0;
    color: var(--md-sys-color-on-surface);
    font-size: 12px;
    line-height: 18px;
    font-weight: 650;
    overflow-wrap: anywhere;
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
      minmax(220px, 1.8fr)
      minmax(150px, 1.05fr)
      minmax(120px, 0.8fr)
      80px
      minmax(120px, 0.8fr);
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
    display: grid;
    gap: 10px;
  }

  .subscriber-connection {
    min-width: 0;
    padding: 14px;
    display: grid;
    gap: 12px;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-md);
    background: var(--md-sys-color-surface-container-low);
  }

  .subscriber-connection > header {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .subscriber-connection > header > div {
    min-width: 0;
    display: grid;
    gap: 2px;
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
    background: rgba(0, 0, 0, 0.48);
    backdrop-filter: blur(4px);
    animation: backdrop-in 140ms ease-out;
  }

  @keyframes backdrop-in { from { opacity: 0; } to { opacity: 1; } }

  .modal {
    width: min(100%, 760px);
    max-height: min(88dvh, 900px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--surface-border);
    border-radius: var(--shape-xl);
    background: var(--md-sys-color-surface-container-lowest);
    box-shadow: var(--shadow-dialog);
    animation: dialog-in 160ms ease-out;
  }

  .modal.sm { width: min(100%, 580px); }
  .modal.lg { width: min(100%, 900px); }
  .modal.wide { width: min(100%, 1040px); }

  @keyframes dialog-in {
    from { opacity: 0; transform: translateY(8px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-header {
    position: sticky;
    top: 0;
    z-index: 2;
    min-height: 74px;
    padding: 16px 16px 14px 22px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid var(--surface-border);
    background: color-mix(in srgb, var(--md-sys-color-surface-container-lowest) 94%, transparent);
    backdrop-filter: blur(14px);
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
    font-size: 20px;
    line-height: 27px;
    font-weight: 720;
    letter-spacing: -0.45px;
    overflow-wrap: anywhere;
  }

  .modal-key {
    width: 100%;
    display: block;
    max-width: min(100%, 680px);
    margin-top: 3px;
    overflow: hidden;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 10px;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .modal-body {
    min-height: 0;
    padding: 22px;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .modal-body > section + section {
    margin-top: 26px;
    padding-top: 23px;
    border-top: 1px solid var(--surface-border);
  }

  .modal-body h3 {
    margin-bottom: 12px;
    font-size: 14px;
    line-height: 20px;
    font-weight: 720;
  }

  .modal-body .empty { margin: 0; }
  .modal-body table { border: 1px solid var(--surface-border); border-radius: var(--shape-md); border-collapse: separate; border-spacing: 0; overflow: hidden; }
  .modal-body table th:first-child { border-top-left-radius: var(--shape-md); }
  .modal-body table th:last-child { border-top-right-radius: var(--shape-md); }

  @media (hover: hover) and (pointer: fine) {
    .nav-item:hover,
    .icon-button:hover,
    .panel-action-button:hover,
    .lookup-detail-button:hover { background: var(--state-hover); }
    .nav-item:hover { color: var(--md-sys-color-on-surface); }
    .lookup-button:not(:disabled):hover { box-shadow: 0 4px 10px rgba(0, 108, 76, 0.24); }
    .click-row:hover { background: var(--state-hover); }
    .sort-button:hover { color: var(--md-sys-color-on-surface); }
    .meshcoreio-map-item:not(.selected):hover { background: var(--state-hover); }
    .meshcoreio-map-fit:hover { background: rgba(28, 42, 34, 0.96); }
  }

  .nav-item:active,
  .icon-button:active,
  .panel-action-button:active,
  .lookup-detail-button:active { background: var(--state-pressed); }
  .lookup-button:not(:disabled):active { transform: translateY(1px); }

  @media (max-width: 1120px) {
    :root { --drawer-width: 224px; }
    .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
    .snapshot-time { min-width: auto; display: block; }
    .snapshot-time > span,
    .snapshot-time small { display: none; }
    .snapshot-time strong { font-size: 14px; line-height: 20px; }

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

    .page-context { display: none; }

    .section-surface {
      border-radius: var(--shape-md);
      box-shadow: 0 1px 2px rgba(21, 31, 25, 0.035);
    }

    .section-header { padding: 17px 16px 13px; }
    .section-header h2 { font-size: 16px; line-height: 22px; }
    .panel-subtitle { font-size: 11px; line-height: 17px; }

    .metrics {
      margin-bottom: 12px;
      gap: 10px;
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
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .lookup-button { width: 100%; }
    .lookup-result { margin: 0 16px 16px; }

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
      content: "›";
      position: absolute;
      top: 11px;
      right: 14px;
      color: var(--md-sys-color-on-surface-variant);
      font-size: 22px;
      line-height: 22px;
    }

    .distribution-list { padding: 0 16px 18px; gap: 16px; }

    .meshcoreio-metrics {
      margin: 0 10px 16px;
    }

    .meshcoreio-panel .section-body > .detail-grid { margin: 0 10px 18px; }
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
      border-radius: var(--shape-xl) var(--shape-xl) var(--shape-md) var(--shape-md);
    }

    .modal-header { padding: 15px 12px 13px 18px; }
    .modal-title { font-size: 18px; line-height: 24px; }
    .modal-body { padding: 16px; }
    .modal-body > section + section { margin-top: 21px; padding-top: 19px; }

    .modal-body table {
      display: block;
      border: 0;
      border-radius: 0;
    }

    .modal-body tbody { padding: 0; }
    .modal-body tbody tr { background: var(--md-sys-color-surface-container-low); }

    .detail-grid,
    .detail-grid.compact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .detail-grid > div { min-height: 72px; padding: 12px; }

    .detail-grid-dl { grid-template-columns: 1fr; }
    .detail-grid-dl dt { padding-bottom: 1px; border-bottom: 0; }
    .detail-grid-dl dd { padding-top: 0; }

    .subscriber-connection > header {
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
    }
  }

  @media (max-width: 460px) {
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

    .lookup-result-header { align-items: flex-start; }
    .lookup-detail-button { margin-top: -7px; }

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

    .detail-grid,
    .detail-grid.compact { grid-template-columns: 1fr; }
    .detail-grid > .detail-wide { grid-column: 1; }
  }

  @media (max-width: 340px) {
    .metrics { grid-template-columns: 1fr; }
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
