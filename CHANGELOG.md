# Changelog

## [0.3.0] - 2026-03-09

### Added
- OpenClaw version check at startup (requires >= 2026.3.7)
- Chinese README (`README_CN.md`)
- Project logo
- npm badges in README
- Rollback instructions in README

### Fixed
- toolCall squeezing preserves type/id/name (prevents API pairing errors)
- Correct token breakdown in README (tool results were missing from stats)

## [0.2.0] - 2026-03-09

### Changed
- **Complete rewrite** — stale content eviction instead of prompt compression
- Handles `toolResult` role messages (67% of context in production)

### Removed
- `archive.ts` — redundant with OpenClaw memory flush
- `classifier.ts` — unnecessary
- `prompts.ts` — prompt compression was solving the wrong problem
- `types.ts` — unused

### Added
- `squeezer.ts` — core squeeze logic (image, toolResult, toolCall eviction)
- `engine.ts` — ContextEngine wrapper using `assemble()` hook

## [0.1.0] - 2026-03-09

### Added
- Initial release (prompt compression approach — superseded)
