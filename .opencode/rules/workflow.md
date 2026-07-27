# Development workflow

- Read the root `AGENTS.md` and every applicable nested `AGENTS.md` before changing files. The nearest file adds the area-specific contract.
- Read the documentation named by those instructions for the affected area.
- Inspect implementation, callers, tests, configuration, and current worktree state before proposing a design. Do not infer behavior from filenames alone.
- Keep the change scoped to the request. Remove accidental complexity rather than adding speculative abstractions.
- Use a focused subagent for compatibility-sensitive, database, UI, security, test, or infrastructure work. For non-trivial changes, request an independent `final-reviewer` pass after implementation.
- Do not stage, commit, amend, reset, clean, rebase, push, publish, or create releases unless the user explicitly requests that exact action.
- Never discard unrelated worktree changes. Check `git status --short` and `git diff` before and after edits when Git metadata exists.
- Resolve valid review findings before declaring completion and rerun affected checks after the final fix.
- Report commands actually run and distinguish passed, failed, unavailable, and skipped checks.
