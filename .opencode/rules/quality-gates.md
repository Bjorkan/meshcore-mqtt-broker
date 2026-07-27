# Quality gates

- Use TypeScript ESM and preserve the ES2020 dashboard build target.
- Prefer explicit types, bound SQL parameters, deterministic ordering, bounded queries, clear ownership, and idempotent cleanup.
- Add regression tests for behavior changes and compatibility-sensitive paths. A compile-only change is not sufficient evidence for runtime behavior.
- Use the smallest relevant test first, then run the broader project checks when dependencies and time permit.
- Run formatting, linting, build, tests, and lockfile portability checks through existing package scripts rather than inventing parallel scripts.
- UI work must include narrow mobile, tablet/narrow desktop, wide desktop, light mode, dark mode, keyboard interaction, loading, empty, error, and long-content checks where relevant.
- Never hide errors with broad catches, `any`, disabled lint rules, skipped tests, arbitrary delays, or weakened assertions unless the user explicitly accepts the tradeoff.
