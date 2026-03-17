/**
 * 🍋 ClawSqueezer — Stale content eviction for OpenClaw
 *
 * Squeezes images, tool results, and exec outputs out of context
 * after they've been processed. Compaction fires 2-3x less often.
 *
 * https://github.com/cldy-com/ClawSqueezer
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { ClawSqueezer } from "./engine.js";
import type { SqueezerConfig } from "./squeezer.js";

const configSchema = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    staleTurns: { type: "number" as const, default: 4, minimum: 1 },
    minTokensToSqueeze: { type: "number" as const, default: 200, minimum: 50 },
    keepPreviewChars: { type: "number" as const, default: 200, minimum: 0 },
    imageAgeTurns: { type: "number" as const, default: 2, minimum: 1 },
    pruneHeartbeats: { type: "boolean" as const, default: true },
    largeResultThreshold: { type: "number" as const, default: 50000, minimum: 0 },
    largeResultPreviewChars: { type: "number" as const, default: 500, minimum: 0 },
  },
};

const clawSqueezerPlugin = {
  id: "clawsqueezer",
  name: "ClawSqueezer",
  version: "1.0.0",
  configSchema,

  register(api: OpenClawPluginApi) {
    const config = (api.pluginConfig ?? {}) as Partial<SqueezerConfig>;

    api.registerContextEngine("clawsqueezer", () => {
      const engine = new ClawSqueezer(config);
      api.logger.info(
        `ClawSqueezer v1.0.0: loaded (staleTurns=${config.staleTurns ?? 4}, imageAgeTurns=${config.imageAgeTurns ?? 2}, minTokens=${config.minTokensToSqueeze ?? 200})`,
      );
      return engine;
    });
  },
};

export default clawSqueezerPlugin;

// Also export for standalone use
export { ClawSqueezer } from "./engine.js";
export { squeeze, type SqueezerConfig, type SqueezeStats } from "./squeezer.js";
export { repairToolPairing, type RepairStats } from "./repair.js";
