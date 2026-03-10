# Changelog

## [1.0.0] - 2026-03-10

### Added
- Tool use/result pairing repair (`repair.ts`) — safety net after squeezing
  - Inserts synthetic error results for missing tool results
  - Drops orphan tool results with no matching tool call
  - Drops duplicate tool results
  - Skips aborted/errored assistant messages
- Engine integration tests (5 tests covering full assemble pipeline)
- `prepare` script for fresh clone / linked installs
- `kind: "context-engine"` in plugin manifest for proper slot selection
- `uiHints` in manifest for Control UI labels
- Proper `configSchema` with `additionalProperties: false`
- GitHub Actions CI workflow (pending `workflow` scope on PAT)
- CodeQL security analysis workflow (pending `workflow` scope on PAT)

### Fixed
- `arguments` field on tool calls now squeezed (was only squeezing `input`)
- Turn aging consistency — all messages in the same turn get the same age
- Runtime version check removed (was comparing plugin version against OpenClaw requirement)
- Config schema on plugin object matches manifest (was using `emptyPluginConfigSchema()`)

### Stats
- 4 source files, 0 runtime dependencies
- 17 tests across 3 suites (squeeze, repair, engine integration)
- Proven benchmark: 55% smaller summaries, 65% fewer tokens vs default OpenClaw
