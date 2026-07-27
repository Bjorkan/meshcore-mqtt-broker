# OpenCode project setup

This setup is tailored to the MeshCore MQTT broker repository. OpenCode discovers the root and nested `AGENTS.md` files automatically. `opencode.jsonc` selects DeepSeek V4 Pro through OpenCode Go, adds the official Material UI MCP server, concise cross-project rules, watcher exclusions, compaction, and safe command defaults.

## Model profile

The main model is:

```text
opencode-go/deepseek-v4-pro
```

The lightweight model used for tasks such as title generation is:

```text
opencode-go/deepseek-v4-flash
```

DeepSeek V4 Pro is well suited to this repository because it is optimized for reasoning, coding, and long-horizon agent work.

| Capability | DeepSeek V4 Pro |
| --- | --- |
| Input/output modalities | Text only |
| Context window | 1,000,000 tokens |
| Maximum output | 384,000 tokens |
| Architecture size | 1.6T total parameters, 49B activated |
| Reasoning | Thinking and non-thinking modes |
| Agent operation | Tool calls supported, including in thinking mode |
| Structured generation | JSON output and chat-prefix completion |
| Code completion | FIM completion in non-thinking mode |

Provider and session limits may reduce practical usable context. Long context is not a reason to load the entire repository indiscriminately. Search first and read only the relevant implementation, callers, tests, and documentation.

It is **text-only**. It cannot inspect screenshots, image pixels, video, or scanned PDF pages.

Consequences for this setup:

- agents must never claim to have visually inspected screenshots,
- UI conclusions must cite source or objective browser/tool evidence,
- screenshots are generated as artifacts for a human reviewer,
- the MUI MCP is documentation-only and does not add vision,
- subjective polish and aesthetics are reported as unverified without human or separately configured vision-capable review.

Official capability references:

- DeepSeek V4 release: `https://api-docs.deepseek.com/news/news260424/`
- DeepSeek models and limits: `https://api-docs.deepseek.com/quick_start/pricing/`
- DeepSeek thinking/tool calls: `https://api-docs.deepseek.com/guides/thinking_mode/`
- OpenCode Go model IDs: `https://opencode.ai/docs/go/`

## Instruction hierarchy

The archive includes only guidance files for real responsibility boundaries:

| Path | Scope |
| --- | --- |
| `AGENTS.md` | Repository architecture, model limits, workflow, security, documentation, and global checks |
| `src/AGENTS.md` | Broker runtime, MQTT compatibility, API, Turso, Aedes persistence, and lifecycle |
| `dashboard/AGENTS.md` | React/Vite/MUI dashboard, Material Design 2, and text-only browser evidence |
| `tests/AGENTS.md` | Jest contracts, deterministic tests, database isolation, cleanup, and UI evidence |
| `scripts/AGENTS.md` | Screenshot harness, demo data, helper scripts, and lockfile checks |
| `.github/workflows/AGENTS.md` | GitHub Actions, permissions, pinned actions, CI, image build, and publishing safety |

Instructions are cumulative. Agents should read the root file and the nearest nested file for each edited path.

## Primary agent

Use `meshcore-dev` for normal development. It owns the complete task, delegates focused analysis, implements changes, runs verification, and requests independent final review.

## Subagents

| Agent | Use it for |
| --- | --- |
| `explore-project` | Read-only code mapping, call-flow tracing, and impact analysis |
| `backend-runtime` | Broker runtime, configuration, API, health, forwarding, and server behavior |
| `database-persistence` | Embedded Turso schema, state, Aedes persistence, cleanup, and restart recovery |
| `mqtt-contract-reviewer` | Read-only review of MQTT authentication, topics, payloads, retain behavior, and compatibility |
| `dashboard-md2` | React/Vite/MUI dashboard implementation using Material Design 2 conventions |
| `dashboard-browser-auditor` | Independent read-only UI audit using DOM, accessibility, computed styles, geometry, and browser errors without vision claims |
| `test-engineer` | Reproductions, focused tests, regression suites, browser assertions, and screenshot harnesses |
| `security-auditor` | Read-only security and trust-boundary review |
| `ci-container` | Docker, package/lockfile, workflows, build and delivery infrastructure |
| `docs-maintainer` | README, architecture, API, migration, and operational documentation |
| `final-reviewer` | Independent, read-only final audit of a completed change |

Subagents can be selected with `@agent-name`. The primary agent also invokes them automatically when their descriptions match the task.

## Commands

- `/work <task>` — full orchestrated implementation
- `/backend <task>` — backend/runtime implementation
- `/database <task>` — database or persistence implementation
- `/ui <task>` — Material Design 2 dashboard implementation with text-only browser verification
- `/ui-audit [scope]` — independent text-only browser/DOM audit without editing
- `/test <scope>` — reproduce a problem and add or improve tests
- `/verify [scope]` — run the appropriate quality gates
- `/protocol-review [scope]` — review MQTT compatibility without editing
- `/security-review [scope]` — security review without editing
- `/final-review [scope]` — independent final review without editing

## Skills

Skills are loaded on demand:

- `project-map`
- `mqtt-contract`
- `turso-persistence`
- `material-design-2`
- `verification`
- `visual-audit`

## Material UI MCP

`opencode.jsonc` starts the official MUI MCP with:

```text
npx -y @mui/mcp@latest
```

The `dashboard-md2` agent calls `useMuiDocs` first and uses `fetchDocs` only with returned official URLs. The project design target remains Material Design 2 even when current MUI examples use newer geometry or styling. The MCP supplies text documentation and code examples; it does not inspect the running UI or screenshots.
