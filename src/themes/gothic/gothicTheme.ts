/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- Astryx theme conditional exports are typed by TypeScript but not resolved by the ESLint project service. */
/**
 * Gothic Theme — dark only
 *
 * A dark-only theme with deep blue-gray tones and a distressed display
 * heading. Inspired by ink, manuscript, and noir typography.
 *
 * Core palette: #E8F1F6, #96A0AB, #495056, #24292D, #101314
 * Categorical colors follow a pastel-on-dark pattern (light backgrounds
 * with dark text) — same in any system color preference.
 *
 * Uses system typography so the dashboard never depends on unbundled fonts.
 */

import { defineTheme, defineSyntaxTheme } from "@astryxdesign/core/theme";
import { gothicIconRegistry } from "./icons.js";

/**
 * Gothic syntax palette — atmospheric tones drawn from the gothic
 * categorical palette: deep purples (cathedral), blood crimson (tags),
 * aged gold (numbers), forest moss (strings), midnight indigo (functions).
 *
 * Single values (no tuples) since this is a dark-only theme.
 */
const gothicSyntax = defineSyntaxTheme({
  name: "xds-gothic",
  tokens: {
    keyword: "#c39adb", // Cathedral plum
    string: "#a3c987", // Forest moss
    comment: "#6b7079", // Faded ink
    number: "#dec074", // Aged gold
    function: "#8aa1d8", // Midnight indigo
    type: "#c39adb", // Cathedral plum
    variable: "#E8F1F6", // Parchment
    operator: "#96A0AB", // Mid neutral
    constant: "#e6b85e", // Candlelight amber
    tag: "#d97580", // Blood crimson
    attribute: "#dec074", // Aged gold
    property: "#7cc5b3", // Verdigris
    punctuation: "#7a8290", // Mid neutral
    background: "#101314",
  },
});

export const gothicTheme = defineTheme({
  name: "gothic",

  typography: {
    scale: { base: 16, ratio: 1.25 },
    body: {
      family: "system-ui",
      fallbacks:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    heading: {
      family: "system-ui",
      fallbacks:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      weights: { 3: "bold", 4: "bold" },
    },
    code: {
      family: "ui-monospace",
      fallbacks: '"SF Mono", Monaco, Consolas, monospace',
    },
  },

  // Slower, theatrical motion — gothic doesn't rush.
  motion: { fast: 150, medium: 350, slow: 800, ratio: 0.75 },

  syntax: gothicSyntax,

  tokens: {
    // =========================================================================
    // Colors — gothic dark palette (single values, dark-only)
    // Core: #E8F1F6, #96A0AB, #495056, #24292D, #101314
    // =========================================================================

    // Core semantic
    "--color-accent": "#E8F1F6",
    "--color-accent-muted": "#E8F1F620",
    "--color-neutral": "#E8F1F61A",
    "--color-background-surface": "#101314",
    "--color-background-body": "#101314",
    "--color-overlay": "#101314CC",
    "--color-overlay-hover": "#E8F1F60D",
    "--color-overlay-pressed": "#E8F1F61A",
    "--color-background-muted": "#24292D",

    // Text
    "--color-text-primary": "#E8F1F6",
    "--color-text-secondary": "#96A0AB",
    "--color-text-disabled": "#495056",
    "--color-text-accent": "#E8F1F6",
    "--color-on-dark": "#E8F1F6",
    "--color-on-light": "#101314",
    "--color-on-accent": "#101314",
    "--color-on-success": "#101314",
    "--color-on-error": "#101314",
    "--color-on-warning": "#101314",

    // Icon
    "--color-icon-accent": "#E8F1F6",
    "--color-icon-primary": "#E8F1F6",
    "--color-icon-secondary": "#96A0AB",
    "--color-icon-disabled": "#495056",

    // Surface variants
    "--color-background-card": "#1a1d20",
    "--color-background-popover": "#24292D",
    "--color-background-inverted": "#E8F1F6",

    // Status / Sentiment — dusty pastels matching the categorical
    // pattern. Used for status surfaces, destructive button bg, etc.
    "--color-success": "#b3c79a", // sage moss
    "--color-success-muted": "#b3c79a24",
    "--color-error": "#c6a6a2", // dusty rose
    "--color-error-muted": "#c6a6a224",
    "--color-warning": "#d3c490", // aged gold
    "--color-warning-muted": "#d3c49024",

    // Border
    "--color-border": "#E8F1F61A",
    "--color-border-emphasized": "#495056",

    // Effects
    "--color-skeleton": "#495056",
    "--color-shadow": "#0000004D",
    "--color-tint-hover": "white",

    // =========================================================================
    // Categorical — dusty pastel-on-dark pattern
    // Hand-tuned dusty pastels (T75 with reduced chroma) — confident
    // but never bright. Neutral is a dark slate with white text — the
    // "no-color" variant earns its hierarchy by matching the page mood.
    // =========================================================================

    // Blue (periwinkle midnight)
    "--color-background-blue": "#a3b5d6",
    "--color-border-blue": "#8696b8",
    "--color-icon-blue": "#2a3b6e",
    "--color-text-blue": "#1f2c54",

    // Cyan (cathedral mist)
    "--color-background-cyan": "#a3c2cf",
    "--color-border-cyan": "#86a4b1",
    "--color-icon-cyan": "#2a5e75",
    "--color-text-cyan": "#204858",

    // Gray (dark slate — special: dark bg + light text)
    "--color-background-gray": "#3d4248",
    "--color-border-gray": "#5d646b",
    "--color-icon-gray": "#E8F1F6",
    "--color-text-gray": "#E8F1F6",

    // Green (sage moss)
    "--color-background-green": "#b3c79a",
    "--color-border-green": "#96a880",
    "--color-icon-green": "#3a5e2c",
    "--color-text-green": "#244023",

    // Orange (warm tan)
    "--color-background-orange": "#d3b89a",
    "--color-border-orange": "#b6987d",
    "--color-icon-orange": "#8a4818",
    "--color-text-orange": "#6e3812",

    // Pink (dusty rose)
    "--color-background-pink": "#c89aab",
    "--color-border-pink": "#aa7d8e",
    "--color-icon-pink": "#8d2d4c",
    "--color-text-pink": "#71223c",

    // Purple (muted plum)
    "--color-background-purple": "#b29bc4",
    "--color-border-purple": "#947da6",
    "--color-icon-purple": "#5a2370",
    "--color-text-purple": "#481b58",

    // Red (dusty rose)
    "--color-background-red": "#c6a6a2",
    "--color-border-red": "#a48581",
    "--color-icon-red": "#5e3a35",
    "--color-text-red": "#4a2520",

    // Teal (sage verdigris)
    "--color-background-teal": "#a3c2b6",
    "--color-border-teal": "#86a499",
    "--color-icon-teal": "#1f5e52",
    "--color-text-teal": "#174a40",

    // Yellow (aged gold)
    "--color-background-yellow": "#d3c490",
    "--color-border-yellow": "#b6a775",
    "--color-icon-yellow": "#876515",
    "--color-text-yellow": "#6c5010",

    // =========================================================================
    // Radius — subtle rounding (original gothic)
    // =========================================================================
    "--radius-none": "0px",
    "--radius-inner": "0.25rem",
    "--radius-element": "0.5rem",
    "--radius-container": "0.75rem",
    "--radius-page": "1.5rem",
    "--radius-full": "9999px",

    // =========================================================================
    // Shadows — restrained, atmospheric
    // =========================================================================
    "--shadow-low": "0 2px 4px #00000033, 0 4px 8px #00000040",
    "--shadow-med": "0 2px 4px #00000033, 0 4px 12px #00000040",
    "--shadow-high": "0 4px 6px #00000040, 0 12px 24px #0000004D",
    "--shadow-inset-hover": "inset 0px 0px 0px 1px #96A0AB30",
    "--shadow-inset-selected": "inset 0px 0px 0px 2px #96A0AB50",
    "--shadow-inset-success": "inset 0px 0px 0px 1px #87b06a50",
    "--shadow-inset-warning": "inset 0px 0px 0px 1px #d6b56a50",
    "--shadow-inset-error": "inset 0px 0px 0px 1px #d4485150",
  },

  components: {
    button: {
      // Primary inherits default — light pill with dark text via
      // --color-accent / --color-on-accent (matches the cream badge).
      // Secondary uses the dark-slate "neutral" badge treatment.
      "variant:secondary": {
        backgroundColor: "var(--color-background-gray)",
        color: "var(--color-text-gray)",
        borderColor: "transparent",
        borderWidth: "0",
      },
      "variant:ghost": {
        ":hover": {
          backgroundColor: "var(--color-overlay-hover)",
        },
      },
      // Destructive uses the dusty rose bg with dark warm-brown text
      // (matches the red badge).
      "variant:destructive": {
        backgroundColor: "var(--color-error)",
        color: "var(--color-text-red)",
      },
    },

    badge: {
      base: {
        borderRadius: "var(--radius-element)",
        fontWeight: "var(--font-weight-medium)",
      },
      "variant:info": {
        backgroundColor: "var(--color-background-blue)",
        color: "var(--color-text-blue)",
      },
      "variant:neutral": {
        backgroundColor: "var(--color-background-gray)",
        color: "var(--color-text-gray)",
      },
      "variant:success": {
        backgroundColor: "var(--color-background-green)",
        color: "var(--color-text-green)",
      },
      "variant:warning": {
        backgroundColor: "var(--color-background-yellow)",
        color: "var(--color-text-yellow)",
      },
      "variant:error": {
        backgroundColor: "var(--color-background-red)",
        color: "var(--color-text-red)",
      },
    },

    banner: {
      base: {
        borderRadius: "var(--radius-element)",
      },
      "status:info": {
        backgroundColor: "var(--color-background-blue)",
        "--color-text-primary": "var(--color-text-blue)",
        "--color-text-secondary": "var(--color-text-blue)",
        "--color-accent": "var(--color-text-blue)",
      },
      "status:success": {
        backgroundColor: "var(--color-background-green)",
        "--color-text-primary": "var(--color-text-green)",
        "--color-text-secondary": "var(--color-text-green)",
        "--color-success": "var(--color-text-green)",
      },
      "status:warning": {
        backgroundColor: "var(--color-background-yellow)",
        "--color-text-primary": "var(--color-text-yellow)",
        "--color-text-secondary": "var(--color-text-yellow)",
        "--color-warning": "var(--color-text-yellow)",
      },
      "status:error": {
        backgroundColor: "var(--color-background-red)",
        "--color-text-primary": "var(--color-text-red)",
        "--color-text-secondary": "var(--color-text-red)",
        "--color-error": "var(--color-text-red)",
      },
    },

    card: {
      base: {
        padding: "var(--spacing-3)",
        borderRadius: "var(--radius-container)",
      },
      // Categorical variants — flip --color-text-primary so child
      // XDSText labels stay readable against the dusty pastel bg.
      "variant:blue": {
        "--color-text-primary": "var(--color-text-blue)",
        "--color-text-secondary": "var(--color-text-blue)",
      },
      "variant:cyan": {
        "--color-text-primary": "var(--color-text-cyan)",
        "--color-text-secondary": "var(--color-text-cyan)",
      },
      "variant:gray": {
        "--color-text-primary": "var(--color-text-gray)",
        "--color-text-secondary": "var(--color-text-gray)",
      },
      "variant:green": {
        "--color-text-primary": "var(--color-text-green)",
        "--color-text-secondary": "var(--color-text-green)",
      },
      "variant:orange": {
        "--color-text-primary": "var(--color-text-orange)",
        "--color-text-secondary": "var(--color-text-orange)",
      },
      "variant:pink": {
        "--color-text-primary": "var(--color-text-pink)",
        "--color-text-secondary": "var(--color-text-pink)",
      },
      "variant:purple": {
        "--color-text-primary": "var(--color-text-purple)",
        "--color-text-secondary": "var(--color-text-purple)",
      },
      "variant:red": {
        "--color-text-primary": "var(--color-text-red)",
        "--color-text-secondary": "var(--color-text-red)",
      },
      "variant:teal": {
        "--color-text-primary": "var(--color-text-teal)",
        "--color-text-secondary": "var(--color-text-teal)",
      },
      "variant:yellow": {
        "--color-text-primary": "var(--color-text-yellow)",
        "--color-text-secondary": "var(--color-text-yellow)",
      },
    },

    section: {
      base: {
        padding: "var(--spacing-3)",
      },
    },

    field: {
      base: {
        borderRadius: "var(--radius-element)",
      },
    },
  },

  icons: gothicIconRegistry,
});
