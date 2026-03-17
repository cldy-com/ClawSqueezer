/**
 * 🍋 ClawSqueezer — ContextEngine plugin for OpenClaw
 *
 * One job: evict stale heavy content from context before each LLM call.
 * Images, tool results, exec outputs — after a few turns, they're dead weight.
 * Squeeze them out. Compaction fires 2-3x less often.
 */

import type {
  ContextEngine,
  AssembleResult,
  CompactResult,
  IngestResult,
  BootstrapResult,
} from "openclaw/plugin-sdk";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { squeeze, type SqueezerConfig, type SqueezeStats } from "./squeezer.js";
import { repairToolPairing } from "./repair.js";

export class ClawSqueezer implements ContextEngine {
  readonly info = {
    id: "clawsqueezer",
    name: "ClawSqueezer",
    version: "1.0.0",
    ownsCompaction: false, // We reduce HOW OFTEN compaction fires, not replace it
  };

  private config: Partial<SqueezerConfig>;
  private lastStats: SqueezeStats | null = null;

  constructor(config?: Partial<SqueezerConfig>) {
    this.config = config || {};
  }

  // ─── Bootstrap ─────────────────────────────────────────────

  async bootstrap(
    _params: { sessionId: string; sessionFile: string },
  ): Promise<BootstrapResult> {
    return { bootstrapped: true };
  }

  // ─── Ingest ────────────────────────────────────────────────
  // No-op — we don't track individual messages. OpenClaw handles persistence.

  async ingest(
    _params: { sessionId: string; message: AgentMessage; isHeartbeat?: boolean },
  ): Promise<IngestResult> {
    return { ingested: false };
  }

  // ─── Assemble ──────────────────────────────────────────────
  // THE CORE: squeeze stale heavy content before each LLM call.

  async assemble(params: {
    sessionId: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  }): Promise<AssembleResult> {
    const { messages: squeezed, stats } = squeeze(
      params.messages as any[],
      this.config,
    );
    this.lastStats = stats;

    if (stats.blocksEvicted === 0) {
      return { messages: params.messages, estimatedTokens: 0 };
    }

    // Repair tool use/result pairing after squeezing
    const { messages: repaired, stats: repairStats } = repairToolPairing(squeezed as any[]);

    const repairInfo = repairStats.repaired
      ? ` | repair: +${repairStats.syntheticResultsInserted} synthetic, -${repairStats.orphanResultsDropped} orphans, -${repairStats.duplicateResultsDropped} dupes`
      : "";

    const heartbeatInfo = stats.heartbeatsPruned > 0 ? `, ${stats.heartbeatsPruned} heartbeats pruned` : "";
    const largeInfo = stats.largeResultsTruncated > 0 ? `, ${stats.largeResultsTruncated} large results truncated` : "";

    console.log(
      `[ClawSqueezer] squeezed: ${stats.blocksEvicted} blocks, ` +
      `~${stats.tokensFreed.toLocaleString()} tokens freed ` +
      `(${stats.imagesEvicted} images, ${stats.toolResultsEvicted} toolResults, ` +
      `${stats.toolCallsEvicted} toolCalls${heartbeatInfo}${largeInfo})${repairInfo}`,
    );

    return {
      messages: repaired as unknown as AgentMessage[],
      estimatedTokens: stats.tokensFreed,
    };
  }

  // ─── Compact ───────────────────────────────────────────────
  // Delegates to legacy compaction. ClawSqueezer's value is in assemble().

  async compact(_params: {
    sessionId: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    legacyParams?: Record<string, unknown>;
  }): Promise<CompactResult> {
    return {
      ok: true,
      compacted: false,
      reason: "ClawSqueezer delegates compaction to legacy — value is in assemble()",
    };
  }

  // ─── After Turn / Dispose ──────────────────────────────────

  async afterTurn(_params: {
    sessionId: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
  }): Promise<void> {}

  async dispose(): Promise<void> {}

  // ─── Public API ────────────────────────────────────────────

  getLastStats(): SqueezeStats | null {
    return this.lastStats;
  }
}
