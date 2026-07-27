# Development script instructions

These instructions apply to `scripts/`. Read the root `AGENTS.md` and `dashboard/AGENTS.md` when changing dashboard seed or screenshot scripts.

## General rules

- Scripts are Node.js ESM (`.mjs`) and must work through the package scripts in `package.json`.
- Keep scripts deterministic, bounded, non-interactive in CI, and explicit about required environment variables.
- Fail with actionable messages and a non-zero exit code. Do not silently swallow partial failures.
- Do not make development scripts alter production configuration or persist state outside their documented test/review locations.
- Do not introduce a dependency when Node built-ins or an existing dependency are sufficient.

## Screenshot harness

DeepSeek V4 Pro cannot inspect screenshot pixels. The harness must therefore expose objective browser failures and produce images only as human-review artifacts. A successful capture is not proof of visual correctness.


For `capture-dashboard-screenshots.mjs`:

- Wait for observable page state, API data, dialog visibility, and completed transitions rather than relying on arbitrary sleeps.
- Select the intended fixture by stable visible text or a dedicated locator; do not wait for one record and click another.
- Support both responsive cards and desktop table rows.
- Keep captures deterministic across runs and give files stable descriptive names.
- Cover all views, desktop/mobile, light/dark, drawers, dialogs, sort states, long values, map interaction, and breakpoint boundaries.
- Treat browser console errors, page errors, horizontal overflow, clipped/off-screen geometry, overlapping fixed regions, undersized targets, and missing expected records as failures.
- Emit or assert useful DOM/accessibility/computed-style/geometry evidence so a text-only agent can diagnose the failure.
- Keep subjective visual inspection outside the automated result and list screenshot paths for a human reviewer.
- Do not commit screenshot output or browser artifacts.

## Demo seed and subscriber helpers

For `seed-dashboard-demo.mjs` and `connect-dashboard-subscriber.mjs`:

- Seed representative edge cases, including long IDs/topics, multiple statuses, equal sort values, warnings/errors, and enough map data to exercise bounds.
- Keep fixture identities and expected records stable so the screenshot harness can target them reliably.
- Use only review/test database setup and never production credentials.
- Ensure helper processes can be terminated cleanly by CI.

## Lockfile portability

`check-lockfile-portability.mjs` protects reproducible installs. Keep checks platform-neutral, deterministic, and aligned with the committed lockfile. Do not auto-rewrite the lockfile from the checker.

## Verification

Run the owning package script plus syntax and lint/format checks. For screenshot changes, run a full live capture plus objective browser assertions. Record generated image paths for human review; do not tell the text-only model to inspect images or treat process exit alone as proof.
