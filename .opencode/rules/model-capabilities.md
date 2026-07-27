# DeepSeek V4 Pro operating constraints

OpenCode is configured to use `opencode-go/deepseek-v4-pro` for primary and delegated development work. Treat the following as hard evidence rules.

## Supported strengths

- Text-only input and output.
- Strong coding, repository analysis, long-horizon agent work, and tool calling.
- A 1,000,000-token context window and maximum 384,000-token output, subject to provider/session limits.
- Thinking and non-thinking modes; tool calls are supported in thinking mode.
- JSON output and chat-prefix completion.
- FIM completion in non-thinking mode.
- A 1.6T-parameter mixture-of-experts architecture with 49B parameters activated per token.

A large context window is not permission to indiscriminately load the repository. Search first, read relevant files, keep summaries, and preserve room for tool output and verification.

## No native vision

DeepSeek V4 Pro cannot inspect image pixels. PNG, JPEG, WebP, GIF, SVG renderings, video frames, screenshots, and scanned PDF pages are opaque unless another tool converts their relevant content into text or measurements.

- Never claim to have visually inspected, seen, viewed, or compared an image.
- Never infer colors, spacing, clipping, alignment, hierarchy, or visual defects solely from a filename or the fact that a screenshot command succeeded.
- The MUI MCP provides official documentation and code examples; it is not a vision service.
- OCR text, image metadata, pixel statistics, or a screenshot-diff score cover only what that tool explicitly reports. Do not expand them into unsupported visual conclusions.
- A screenshot artifact may be generated for human review, but its existence is not proof that the UI looks correct.

## Text-only UI evidence

For dashboard work, build conclusions from source and objective browser/tool output:

- DOM structure and accessible names,
- accessibility tree and keyboard behavior,
- computed styles, breakpoints, and theme values,
- element bounding boxes and viewport intersections,
- `scrollWidth`/`clientWidth` overflow checks,
- clipping, overlap, off-screen, and minimum-target-size assertions,
- browser console and page errors,
- visible text, record completeness, sort order, and dialog state,
- automated contrast calculations from computed foreground/background values,
- deterministic screenshot-diff results when a reviewed baseline and threshold already exist.

State exactly which evidence was collected. Mark subjective appearance, polish, balance, and aesthetic judgment as requiring human or separately configured vision-capable review.
