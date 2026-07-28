---
description: Run the appropriate project quality gates and diagnose failures
agent: test-engineer
---

Verify the current worktree. Scope or special focus:

$ARGUMENTS

Inspect the diff, choose the smallest relevant tests first, then run applicable lockfile, formatting, lint, build, Jest, and dashboard browser/screenshot checks. Diagnose failures instead of merely listing them. For UI work, use objective browser assertions and list screenshot artifacts for human review; do not claim that DeepSeek V4 Pro visually inspected them. Do not modify production behavior unless necessary to fix a confirmed issue, and do not stage or commit.
