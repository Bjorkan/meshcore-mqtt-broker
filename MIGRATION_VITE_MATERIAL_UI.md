# Vite + MUI v9 Migration Plan

## Overview

Migrate the dashboard from hand-rolled esbuild + custom MD3 CSS to Vite + MUI v9.

|                 | Current                                                    | Target                                                 |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Bundler         | esbuild CLI                                                | Vite 6                                                 |
| UI library      | Hand-rolled MD3 CSS (2095 lines) + custom React components | MUI v9 (Material Design 2)                             |
| Icons           | Hand-coded MDI SVG paths (12 icons)                        | `@mui/icons-material`                                  |
| CSS             | Template literal string (`DASHBOARD_STYLES`)               | Removed — MUI handles all styling                      |
| Dev server      | `ts-node` ESM loader, no HMR                               | Vite dev server with React Fast Refresh + `/api` proxy |
| Build output    | `dist/public/dashboard-client.js` (unhashed)               | `dist/public/assets/index-[hash].js` (hashed)          |
| Backend serving | Reads JS/CSS into memory, generates HTML dynamically       | Reads Vite-built `index.html` into memory cache        |
| Entry file      | `src/dashboard-client.tsx` (3367 lines, monolithic)        | `dashboard/src/main.tsx` → split into 25+ files        |
| Routing         | Hash-based (`#overview`, `#observers`, etc.)               | Preserved (unchanged)                                  |

## Design Decisions

| Decision               | Choice                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| UI library             | MUI v9 (Material Design 2 — the MD3 migration is still incomplete in MUI)    |
| Dark mode              | Manual toggle (IconButton), overrides system preference via `ThemeProvider`  |
| Font                   | Roboto via Google Fonts CDN `<link>` in `index.html` (MUI default)           |
| Routing                | Existing hand-written hash router, preserved                                 |
| Component architecture | Aggressive split — layout, data, UI, and detail components in separate files |
| esbuild                | Removed entirely — Vite replaces it                                          |
| `ts-node`              | Removed — `tsx` (already a dependency) replaces it for the dev server script |

## File Structure

```
meshcore-mqtt-broker/
├── vite.config.ts                              # NEW: Vite configuration at project root
├── src/                                        # Server-side Node.js code
│   ├── server.ts                               # UNCHANGED
│   ├── dashboard.ts                            # UPDATED: simplified HTML serving
│   ├── dashboard-styles.ts                     # DELETED
│   ├── dashboard-client.tsx                    # DELETED (split into dashboard/src/)
│   ├── dashboard-helpers.ts                    # MOVED to dashboard/src/helpers/
│   ├── css.d.ts                                # DELETED (no more CSS imports)
│   ├── database.ts                             # UNCHANGED
│   └── ... (all other server files unchanged)
├── dashboard/                                  # NEW: all frontend code
│   ├── index.html                              # Vite HTML entry (includes Roboto <link>)
│   ├── tsconfig.json                           # IDE support for dashboard TypeScript
│   ├── public/
│   │   └── favicon.svg                         # Moved from src/dashboard.ts inline
│   └── src/
│       ├── main.tsx                            # ThemeProvider + CssBaseline + React mount
│       ├── theme.ts                            # createTheme with green palette, dark/light
│       ├── app.tsx                             # App shell (layout + router + data fetching + state)
│       ├── api.ts                              # fetchJson, polling hook
│       ├── types.ts                            # All TypeScript interfaces and types
│       ├── router.ts                           # useHashRouter() custom hook
│       ├── helpers/
│       │   ├── format.ts                       # formatRegionDisplay, formatDeniedUntilLabel
│       │   └── time.ts                         # Stockholm time formatting
│       ├── views/
│       │   ├── overview.tsx                    # Metric cards, top observers, activity feed, bans summary
│       │   ├── observers.tsx                   # Observer table + search + region filter
│       │   ├── meshcore-io.tsx                 # Queue metrics + MapLibre GL map
│       │   ├── bans.tsx                        # Protection events table
│       │   └── subscribers.tsx                 # Subscriber connections table
│       └── components/
│           ├── layout/
│           │   ├── app-shell.tsx               # Drawer + AppBar + content area container
│           │   ├── top-app-bar.tsx             # AppBar + dark mode toggle + updated time
│           │   └── nav-drawer.tsx              # Drawer + List navigation items
│           ├── data/
│           │   ├── metric-card.tsx             # Card with value + label
│           │   ├── data-table.tsx              # Sortable MUI Table with pagination
│           │   ├── status-badge.tsx            # Chip: online/offline/blocked
│           │   └── empty-state.tsx             # Empty state with Typography + icon
│           ├── ui/
│           │   ├── search-bar.tsx              # TextField + InputAdornment with search icon
│           │   ├── region-filter.tsx           # TextField select dropdown
│           │   ├── loader.tsx                  # CircularProgress / Skeleton
│           │   └── time-ago.tsx                # Relative time display
│           └── details/
│               ├── observer-detail.tsx         # Dialog with observer info
│               ├── subscriber-detail.tsx       # Dialog with subscriber info
│               └── ban-detail.tsx              # Dialog with ban info
├── dist/                                       # Build output
│   ├── server.ts → ...                         # Server build (tsc, unchanged)
│   └── public/                                 # Vite build output
│       ├── index.html                          # Built HTML with hashed asset references
│       ├── assets/
│       │   ├── index-Dh3x9fK2.js               # Hashed JS bundle
│       │   └── index-BkL9sWq1.css              # Hashed CSS bundle
│       └── favicon.svg                         # Copied from dashboard/public/
└── tests/
    └── dashboard-helpers.test.mjs              # UPDATED: source paths + bundle paths
```

## Vite Configuration

`vite.config.ts` (at project root):

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "dashboard"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2020",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
```

## Dashboard HTML Entry

`dashboard/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MeshCore MQTT Dashboard</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## Dashboard Entry Point

`dashboard/src/main.tsx`:

```typescript
import { createRoot } from "react-dom/client";
import { App } from "./app.js";

createRoot(document.getElementById("root")!).render(<App />);
```

## MUI Theme

`dashboard/src/theme.ts`:

```typescript
import { createTheme } from "@mui/material/styles";

export function createAppTheme(prefersDark: boolean) {
  return createTheme({
    palette: {
      mode: prefersDark ? "dark" : "light",
      primary: { main: "#006c4c" },
      secondary: { main: "#48665a" },
      error: { main: "#ba1a1a" },
      warning: { main: "#805600" },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    },
  });
}
```

Dark mode is toggled by the user via an `IconButton` in the top app bar. The preference is stored in `localStorage` and defaults to the OS preference when unset.

## App Shell

`dashboard/src/app.tsx`:

```typescript
import { ThemeProvider, CssBaseline, useMediaQuery } from "@mui/material";
import { useState, useCallback, useEffect } from "react";
import { createAppTheme } from "./theme.js";
import { useHashRouter } from "./router.js";
import { useDashboardData } from "./api.js";
import { AppShell } from "./components/layout/app-shell.js";
// ... view imports

export function App() {
  const prefersDarkSystem = useMediaQuery("(prefers-color-scheme: dark)");
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem("dashboard-dark-mode");
    return stored !== null ? stored === "true" : prefersDarkSystem;
  });

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      localStorage.setItem("dashboard-dark-mode", String(!prev));
      return !prev;
    });
  }, []);

  const theme = createAppTheme(darkMode);
  const [route, navigate] = useHashRouter();
  const { data, error, lastUpdated } = useDashboardData();

  if (!data) return <Loader error={error} />;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppShell
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        lastUpdated={lastUpdated}
        route={route}
        onNavigate={navigate}
      >
        {/* Route-based view rendering */}
      </AppShell>
    </ThemeProvider>
  );
}
```

## MUI Component Mapping

| Current Hand-Rolled                 | MUI v9 Replacement                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CSS Grid sidebar + top bar layout   | `Drawer` + `AppBar` + `Toolbar` + `Box` with `sx`                                                                                                            |
| Custom `<nav>` links                | `List` + `ListItemButton` + `ListItemIcon` + `ListItemText`                                                                                                  |
| Metric cards                        | `Card` + `CardContent` + `Typography`                                                                                                                        |
| Sortable `<table>`                  | `Table` + `TableHead` + `TableBody` + `TableRow` + `TableCell` + `TableSortLabel` + `TablePagination`                                                        |
| Search `<input>`                    | `TextField variant="outlined"` + `InputAdornment position="start"` + `SearchIcon`                                                                            |
| Region `<select>` dropdown          | `TextField select`                                                                                                                                           |
| Custom modals with focus trapping   | `Dialog` + `DialogTitle` + `DialogContent` + `DialogActions`                                                                                                 |
| Hand-coded MDI SVG paths (12 icons) | `@mui/icons-material` (tree-shaken): `People`, `Close`, `Home`, `Menu`, `Search`, `ShowChart`, `Dns`, `Shield`, `Groups`, `CloudUpload`, `GpsFixed`, `Place` |
| Status badges                       | `Chip color="success"` / `Chip color="error"` / `Chip color="warning"`                                                                                       |
| Loading spinner                     | `CircularProgress` / `Skeleton`                                                                                                                              |
| Dark mode toggle                    | `IconButton` + `DarkModeIcon` / `LightModeIcon`                                                                                                              |
| Responsive breakpoints              | MUI's built-in `useMediaQuery` + `Grid2` / `Stack` / `Box` responsive `sx` props                                                                             |

## Dependencies

### Added

| Package                | Version | Purpose                                     |
| ---------------------- | ------- | ------------------------------------------- |
| `@mui/material`        | ^9      | Material Design 2 React component library   |
| `@mui/icons-material`  | ^9      | Material Design Icons                       |
| `@emotion/react`       | ^11     | CSS-in-JS runtime (MUI peer dependency)     |
| `@emotion/styled`      | ^11     | Styled component API (MUI peer dependency)  |
| `vite`                 | ^6      | Build tool and dev server                   |
| `@vitejs/plugin-react` | ^4      | React Fast Refresh + JSX transform for Vite |

### Removed

| Package   | Reason                                            |
| --------- | ------------------------------------------------- |
| `esbuild` | Replaced by Vite (Rollup-based production builds) |
| `ts-node` | Replaced by `tsx` (already in dependencies)       |

### Unchanged (still needed)

`react`, `react-dom`, `maplibre-gl` (map view), `tslog` (client-side logging).

## npm Scripts

```jsonc
{
  "scripts": {
    // Development: backend on port 8080 (from config.yaml)
    "dev": "tsx src/server.ts",
    // Development: Vite dev server on port 5173, proxies /api to 8080
    "dev:dashboard": "vite",
    // Production build: compile server + bundle dashboard
    "build": "tsc && vite build",
    // Server-only build
    "build:server": "tsc",
    // Dashboard-only build
    "build:dashboard": "vite build",
    // Tests (unchanged workflow)
    "test": "npm run build && node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand",
    "test:ci": "npm run build && node --expose-gc --experimental-vm-modules node_modules/jest/bin/jest.js --ci --runInBand --verbose --showSeed --logHeapUsage --detectOpenHandles",
    // Linting
    "lint": "eslint . --max-warnings=0",
    "lint:fix": "eslint . --fix",
    // Formatting
    "format": "prettier . --write",
    "format:check": "prettier . --check",
    // Pre-commit check
    "check": "npm run check:lockfile && npm run format:check && npm run lint && npm run build",
    // Production start
    "start": "node dist/server.js",
    // Lockfile portability check
    "check:lockfile": "node scripts/check-lockfile-portability.mjs",
  },
}
```

## Backend Changes (`src/dashboard.ts`)

### Removed

- `import { DASHBOARD_STYLES } from "./dashboard-styles.js"` — MUI handles all styling
- `sendDashboardClient()` — Vite's built `index.html` contains hashed `<script>` tags
- `sendDashboardClientStyles()` — CSS is bundled into the Vite JS output
- `sendFavicon()` / `/favicon.svg` route — Vite copies `dashboard/public/favicon.svg` to `dist/public/`
- `renderDashboardHtml()` dynamic HTML generation — replaced by reading Vite output

### Changed

`renderDashboardHtml()` simplified to read Vite's built `index.html`:

```typescript
import { readFileSync } from "fs";

let cachedDashboardHtml: string | null = null;
let cachedDashboardHtmlError: string | null = null;

function loadDashboardHtml(): string {
  if (cachedDashboardHtml !== null) return cachedDashboardHtml;
  if (cachedDashboardHtmlError !== null) return cachedDashboardHtmlError;

  try {
    cachedDashboardHtml = readFileSync("dist/public/index.html", "utf-8");
    return cachedDashboardHtml;
  } catch (err) {
    cachedDashboardHtmlError = "Dashboard not built. Run `npm run build`.";
    log.error("failed to load dashboard HTML:", err);
    return cachedDashboardHtmlError;
  }
}
```

### Preserved

- `/api/dashboard` JSON endpoint — unchanged
- `/api/v1/observers/:key/status` endpoint — unchanged
- Memory caching pattern (load once at startup) — unchanged
- `DashboardState` class and snapshot builder — unchanged
- `createDashboardServer()` factory — unchanged

## Dockerfile Changes

Minimal change — `npm run build` now runs `tsc && vite build` instead of `tsc && esbuild ...`:

```dockerfile
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY dashboard ./dashboard
RUN npm run build && npm prune --omit=dev

# Runtime stage unchanged
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /app/dist/cli.js \
  && ln -s /app/dist/cli.js /usr/local/bin/mc-mqtt
EXPOSE 8080 8883
HEALTHCHECK --interval=45s --timeout=50s --start-period=20s --retries=3 CMD ["setpriv", "--reuid=node", "--regid=node", "--init-groups", "node", "dist/healthcheck.js"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
```

## tsconfig.json Changes

Add `exclude` for the dashboard directory since Vite handles its own TypeScript compilation:

```jsonc
{
  "compilerOptions": {
    // ... all existing options unchanged
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "dashboard"],
}
```

Add `dashboard/tsconfig.json` for IDE support:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

## Test Updates

`tests/dashboard-helpers.test.mjs` needs the following updates:

1. **Source file path references**: `src/dashboard-client.tsx` → `dashboard/src/` equivalent files
2. **Bundle path**: `dist/public/dashboard-client.js` → Parse `dist/public/index.html` at runtime to find the hashed asset filename, then check that file
3. **Source content checks**: Update string searches to target the correct new component files (e.g., `ObserverLookup` is now in `dashboard/src/views/overview.tsx`)
4. **`DASHBOARD_STYLES` import test**: Removed (CSS is now in MUI theme)
5. **`dashboard-styles.js` import test**: Removed

Helper function for resolving hashed bundle path in tests:

```javascript
import { readFileSync } from "fs";

function findDashboardBundle() {
  const html = readFileSync("dist/public/index.html", "utf-8");
  const match = html.match(/\/assets\/index-[^"]+\.js/);
  if (!match) throw new Error("Could not find hashed JS bundle in index.html");
  return `dist/public${match[0]}`;
}
```

## Deleted Files

| File                       | Reason                                                            |
| -------------------------- | ----------------------------------------------------------------- |
| `src/dashboard-client.tsx` | Split into 25+ files under `dashboard/src/`                       |
| `src/dashboard-styles.ts`  | Replaced by MUI theme (`dashboard/src/theme.ts`)                  |
| `src/css.d.ts`             | Vite handles CSS natively; no `.css` TypeScript imports needed    |
| `src/dashboard-helpers.ts` | Moved to `dashboard/src/helpers/` (only used by dashboard client) |

## Execution Order

| #   | Step                                                                                                                                                                  | Risk   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `npm install` new deps (`@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`, `vite`, `@vitejs/plugin-react`), `npm uninstall esbuild ts-node` | Low    |
| 2   | Create `vite.config.ts`, `dashboard/` directory scaffold, `dashboard/index.html`, `dashboard/public/favicon.svg`, `dashboard/tsconfig.json`                           | Low    |
| 3   | Create `dashboard/src/theme.ts` + `dashboard/src/main.tsx` (ThemeProvider, CssBaseline, Roboto, React mount)                                                          | Low    |
| 4   | Extract `dashboard/src/types.ts` from `dashboard-client.tsx`                                                                                                          | Low    |
| 5   | Extract `dashboard/src/api.ts` (fetchJson, polling, error handling)                                                                                                   | Low    |
| 6   | Extract `dashboard/src/router.ts` (useHashRouter hook)                                                                                                                | Low    |
| 7   | Move helpers to `dashboard/src/helpers/format.ts` + `dashboard/src/helpers/time.ts`, delete `src/dashboard-helpers.ts`                                                | Low    |
| 8   | Build layout components: `app-shell.tsx`, `top-app-bar.tsx` (with dark mode toggle), `nav-drawer.tsx`                                                                 | Medium |
| 9   | Build data components: `metric-card.tsx`, `data-table.tsx`, `status-badge.tsx`, `empty-state.tsx`                                                                     | Medium |
| 10  | Build UI components: `search-bar.tsx`, `region-filter.tsx`, `loader.tsx`, `time-ago.tsx`                                                                              | Medium |
| 11  | Build detail components: `observer-detail.tsx`, `subscriber-detail.tsx`, `ban-detail.tsx`                                                                             | Medium |
| 12  | Build views: `overview.tsx`, `observers.tsx`, `meshcore-io.tsx`, `bans.tsx`, `subscribers.tsx`                                                                        | Medium |
| 13  | Build `dashboard/src/app.tsx` (assemble shell + routing + data fetching + state management)                                                                           | Medium |
| 14  | Update `src/dashboard.ts` backend (simplify HTML serving, remove style/client/static file routes)                                                                     | Medium |
| 15  | Update `package.json` scripts + remove esbuild/ts-node from devDependencies                                                                                           | Low    |
| 16  | Update `tsconfig.json` (exclude `dashboard/`)                                                                                                                         | Low    |
| 17  | Update `tests/dashboard-helpers.test.mjs` (new file paths, hashed bundle resolution)                                                                                  | Medium |
| 18  | Update `Dockerfile` (replace esbuild build step)                                                                                                                      | Low    |
| 19  | Delete old files: `src/dashboard-client.tsx`, `src/dashboard-styles.ts`, `src/css.d.ts`                                                                               | Low    |
| 20  | Run `npm run build` — verify clean compilation                                                                                                                        | High   |
| 21  | Run `npm test` — verify all tests pass                                                                                                                                | High   |
| 22  | Manual visual verification in `npm run dev` + `npm run dev:dashboard`                                                                                                 | High   |

## Risks and Mitigations

| Risk                                                                     | Mitigation                                                                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| MUI Drawer/AppBar layout doesn't match current responsive behavior       | Keep existing responsive breakpoints via `useMediaQuery` + `sx` props on MUI components               |
| MapLibre GL CSS import path changes with Vite                            | Vite handles `import "maplibre-gl/dist/maplibre-gl.css"` natively                                     |
| MUI theme tokens (spacing, typography scale) differ from hand-rolled MD3 | Accept MD2 visual differences as the chosen path                                                      |
| `dashboard-helpers.test.mjs` string matching against new bundle format   | Update patterns to account for hashed filenames and MUI component markup                              |
| `tslog` import in client code may conflict with Vite bundling            | Verify `tslog` works in browser context with Vite; if not, replace with lightweight `console` wrapper |
| React 19 + MUI v9 compatibility                                          | MUI v9 officially supports React 19                                                                   |
| Playwright tests (if any e2e exist for dashboard)                        | Verify against new Vite-served dashboard, update selectors for MUI component markup                   |

## Development Workflow

Terminal 1 — backend:

```bash
npm run dev
# Backend starts on configured port (typically 8080)
```

Terminal 2 — dashboard:

```bash
npm run dev:dashboard
# Vite starts on http://localhost:5173
# Proxies /api/* requests to http://localhost:8080
# React Fast Refresh (HMR) enabled
```

Open http://localhost:5173 in the browser. Changes to `dashboard/src/` files trigger instant hot reloads without full page refresh.

## Production Build

```bash
npm run build
# 1. tsc compiles src/ → dist/ (server-side)
# 2. vite build compiles dashboard/ → dist/public/ (hashed assets)
```

The backend reads `dist/public/index.html` at startup and serves it for all dashboard routes.
