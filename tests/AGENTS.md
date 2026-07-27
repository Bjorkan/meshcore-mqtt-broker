# Test instructions

These instructions apply to `tests/`. Read the root `AGENTS.md` and the nearest instructions for the production area under test.

## Test model

The Jest suite is ESM and generally tests built output. Respect the repository scripts and `jest.config.mjs`; do not create a second test runner or bypass the normal build unless a focused diagnostic explicitly requires it.

Tests are executable contracts for MQTT compatibility, persistence, restart recovery, configuration, API behavior, and lifecycle. Preserve useful negative cases and exact observable behavior.

## Test quality

- Reproduce a bug before changing production behavior when feasible.
- Prefer deterministic inputs, explicit clocks, bounded waits, exact topic/payload assertions, and observable readiness conditions.
- Do not use arbitrary sleeps when a state, event, API response, or process condition can be awaited.
- Use isolated temporary databases through `tests/test-database.mjs`; never touch the production database path.
- Close brokers, clients, servers, timers, workers, and databases in `finally`/cleanup paths so tests do not leak handles.
- For MQTT changes, test both allowed and denied paths and verify what subscribers actually receive.
- For persistence changes, test close/reopen and recovery, not only writes in one process.
- For queue or cleanup changes, test bounds, expiration, ordering, and idempotency.
- For config changes, test valid values, malformed values, missing required values, and unsupported coercions.
- Do not weaken assertions, expand timeouts without evidence, skip failing cases, disable leak detection, or alter production semantics merely to make a test pass.


## UI evidence with a text-only model

DeepSeek V4 Pro cannot inspect screenshots. For dashboard regressions, assert DOM/accessibility state, computed styles, bounding boxes, viewport intersections, overflow, target sizes, keyboard behavior, console/page errors, and deterministic baseline diffs. Screenshot files may be emitted for human review, but capture success or the file itself is not a visual assertion.

## Conventions

- Mirror the existing `.test.mjs` style and helper patterns.
- Assert stable external behavior rather than private implementation details unless the private boundary is itself the contract.
- Use deterministic tie-breakers in expected ordered results.
- Keep fixtures small and readable; generate repetitive data programmatically.
- Include the regression reason in the test name or nearby comment when it is not obvious.

## Commands

Start with the smallest matching test after the required build, for example:

```bash
npm run build
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/neighbors.test.mjs
```

Then run the broader gates as appropriate:

```bash
npm test
npm run test:ci
npm run lint
npm run format:check
```

If a command cannot run because of dependency, browser, Docker, Node-version, or network limitations, report that separately from code failures.
