export const DASHBOARD_STYLES = String.raw`
  /* Let responsive grids shrink inside AppShell's desktop flex content region. */
  .astryx-layout-content {
    min-width: 0;
  }

  .metrics,
  .meshcoreio-panel > * > .astryx-metadata-list {
    margin-inline: var(--spacing-4);
  }

  .meshcoreio-metrics {
    margin-block-end: var(--spacing-4);
  }

  .click-row {
    cursor: pointer;
  }

  /* Composed Astryx tables need explicit column budgets to enable narrow-screen scrolling. */
  .astryx-table-header-cell,
  .astryx-table-cell {
    min-width: 120px;
  }

  .primary-cell {
    min-width: 180px;
  }

  .wide-cell {
    min-width: 180px;
  }

  .topic-cell {
    min-width: 240px;
  }

  .primary-stack {
    min-width: 0;
    display: grid;
    gap: var(--spacing-1);
  }

  .cell-value {
    min-width: 0;
    color: var(--color-text-primary);
    font-weight: var(--font-weight-semibold);
    overflow-wrap: anywhere;
  }

  .cell-note {
    color: var(--color-text-secondary);
    font-size: var(--text-supporting-size);
    line-height: var(--text-supporting-leading);
  }

  .topic-code,
  .neighbor-key,
  .scope-list {
    color: var(--color-text-secondary);
    font-family: var(--font-family-code);
    font-size: var(--text-supporting-size);
    overflow-wrap: anywhere;
  }

  .new-publish {
    animation: publish-highlight var(--duration-slow-max) var(--ease-standard);
  }

  @keyframes publish-highlight {
    from { background: var(--color-accent-muted); }
    to { background: transparent; }
  }

  .meshcoreio-map-section {
    margin: 0 var(--spacing-4) var(--spacing-6);
    overflow: hidden;
  }

  .meshcoreio-map-layout {
    min-height: 486px;
    grid-template-columns: minmax(0, 1fr) minmax(268px, 32%);
    border-top: var(--border-width) solid var(--color-border);
  }

  .meshcoreio-map-column {
    min-width: 0;
    border-inline-end: var(--border-width) solid var(--color-border);
    background: var(--color-background-surface);
  }

  .meshcoreio-map-canvas {
    width: 100%;
    height: 414px;
    background: var(--color-background-muted);
  }

  .meshcoreio-map-canvas .maplibregl-map,
  .meshcoreio-map-canvas .maplibregl-canvas-container,
  .meshcoreio-map-canvas .maplibregl-canvas {
    width: 100%;
    height: 100%;
  }

  .meshcoreio-map-canvas .maplibregl-ctrl-group {
    overflow: hidden;
    border: var(--border-width) solid color-mix(in srgb, var(--color-on-dark) 45%, transparent);
    border-radius: var(--radius-element);
    box-shadow: var(--shadow-low);
  }

  .meshcoreio-map-canvas .maplibregl-ctrl-group button {
    width: var(--spacing-11);
    height: var(--spacing-11);
  }

  .meshcoreio-map-canvas .maplibregl-ctrl-attrib {
    color: var(--color-on-light);
    font-size: var(--font-size-xs);
  }

  .meshcoreio-map-dot {
    width: var(--spacing-2);
    height: var(--spacing-2);
    display: block;
    flex: none;
    border-radius: var(--radius-full);
    background: #5e6d64;
  }

  .meshcoreio-map-dot.repeater { background: #087f5b; }
  .meshcoreio-map-dot.room { background: #2f6f89; }
  .meshcoreio-map-dot.sensor { background: #a15c00; }

  .meshcoreio-map-selection {
    border-top: var(--border-width) solid var(--color-border);
    background: var(--color-background-surface);
  }

  .meshcoreio-map-list {
    max-height: 486px;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--color-background-surface);
  }

  @media (max-width: 920px) {
    .meshcoreio-map-layout { grid-template-columns: 1fr; }
    .meshcoreio-map-column {
      border-inline-end: 0;
      border-block-end: var(--border-width) solid var(--color-border);
    }
    .meshcoreio-map-list { max-height: 310px; }
  }

  @media (max-width: 460px) {
    .meshcoreio-map-canvas { height: 320px; }
    .meshcoreio-map-list { max-height: 330px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .new-publish { animation: none; }
  }
`;
