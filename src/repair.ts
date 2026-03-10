/**
 * 🍋 Tool use/result pairing repair for ClawSqueezer.
 *
 * After squeezing, tool_use and tool_result messages might be in a state
 * that the LLM API rejects. This module ensures:
 *
 * 1. Every tool_use has a matching tool_result (inserts synthetic error if missing)
 * 2. Every tool_result has a matching tool_use (drops orphans)
 * 3. No duplicate tool_results for the same id
 * 4. tool_results are positioned after their matching tool_use
 */

interface MessageLike {
  role: string;
  content?: unknown;
  toolCallId?: string;
  toolUseId?: string;
  toolName?: string;
  stopReason?: string;
  isError?: boolean;
  [key: string]: unknown;
}

interface ToolCallRef {
  id: string;
  name?: string;
}

const TOOL_CALL_TYPES = new Set([
  "toolCall", "toolUse", "tool_use", "tool-use",
  "functionCall", "function_call",
]);

/** Extract tool call id from a content block */
function extractBlockId(block: Record<string, unknown>): string | null {
  if (typeof block.id === "string" && block.id) return block.id;
  if (typeof block.call_id === "string" && block.call_id) return block.call_id;
  return null;
}

/** Extract tool calls from an assistant message */
function extractToolCalls(msg: MessageLike): ToolCallRef[] {
  if (!Array.isArray(msg.content)) return [];
  const calls: ToolCallRef[] = [];
  for (const block of msg.content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const id = extractBlockId(b);
    if (!id) continue;
    if (typeof b.type === "string" && TOOL_CALL_TYPES.has(b.type)) {
      calls.push({ id, name: typeof b.name === "string" ? b.name : undefined });
    }
  }
  return calls;
}

/** Get the tool result's reference id */
function getResultId(msg: MessageLike): string | null {
  if (typeof msg.toolCallId === "string" && msg.toolCallId) return msg.toolCallId;
  if (typeof msg.toolUseId === "string" && msg.toolUseId) return msg.toolUseId;
  return null;
}

/** Create a synthetic error result for a missing tool result */
function makeSyntheticResult(callId: string, toolName?: string): MessageLike {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: toolName ?? "unknown",
    content: [{
      type: "text",
      text: "[ClawSqueezer] missing tool result — synthetic error inserted for API compatibility.",
    }],
    isError: true,
  };
}

function isAssistantAborted(msg: MessageLike): boolean {
  return msg.stopReason === "error" || msg.stopReason === "aborted";
}

export interface RepairStats {
  syntheticResultsInserted: number;
  orphanResultsDropped: number;
  duplicateResultsDropped: number;
  repaired: boolean;
}

/**
 * Repair tool use/result pairing in a message array.
 * Call this AFTER squeezing to ensure the API won't reject the transcript.
 */
export function repairToolPairing<T extends MessageLike>(messages: T[]): {
  messages: T[];
  stats: RepairStats;
} {
  const stats: RepairStats = {
    syntheticResultsInserted: 0,
    orphanResultsDropped: 0,
    duplicateResultsDropped: 0,
    repaired: false,
  };

  // Phase 1: collect all non-aborted tool calls (the only valid result anchors)
  const allCallIds = new Map<string, string | undefined>(); // id → toolName
  for (const msg of messages) {
    if (msg.role !== "assistant" || isAssistantAborted(msg)) continue;
    for (const call of extractToolCalls(msg)) {
      allCallIds.set(call.id, call.name);
    }
  }

  // Phase 1b: pre-scan valid tool results so we only insert synthetics
  // for calls that truly have no real result anywhere in the transcript.
  const callsWithRealResult = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    const id = getResultId(msg);
    if (id && allCallIds.has(id)) {
      callsWithRealResult.add(id);
    }
  }

  // Fast-path: no tool calls and no tool results => unchanged
  const hasToolResults = messages.some((m) => m.role === "toolResult");
  if (allCallIds.size === 0 && !hasToolResults) {
    return { messages, stats };
  }

  // Phase 2: stream messages and ensure results never appear before calls.
  // Keep early results in pending, flush them right after their call.
  const seenCallIds = new Set<string>();
  const seenResultIds = new Set<string>();
  const pendingResults = new Map<string, T>();
  const out: T[] = [];

  for (const msg of messages) {
    if (msg.role === "toolResult") {
      const id = getResultId(msg);

      // Orphan — no matching non-aborted tool call in transcript
      if (!id || !allCallIds.has(id)) {
        stats.orphanResultsDropped++;
        continue;
      }

      // Duplicate — already emitted or already pending for same id
      if (seenResultIds.has(id) || pendingResults.has(id)) {
        stats.duplicateResultsDropped++;
        continue;
      }

      // If call already seen, keep it in place; otherwise defer until call appears.
      if (seenCallIds.has(id)) {
        out.push(msg);
        seenResultIds.add(id);
      } else {
        pendingResults.set(id, msg);
      }
      continue;
    }

    out.push(msg);

    if (msg.role === "assistant" && !isAssistantAborted(msg)) {
      for (const call of extractToolCalls(msg)) {
        seenCallIds.add(call.id);

        // Flush out-of-order result immediately after matching tool call
        const pending = pendingResults.get(call.id);
        if (pending && !seenResultIds.has(call.id)) {
          out.push(pending);
          seenResultIds.add(call.id);
          pendingResults.delete(call.id);
          continue;
        }

        // If there is no real result anywhere, insert synthetic adjacent to the call.
        if (!callsWithRealResult.has(call.id) && !seenResultIds.has(call.id)) {
          out.push(makeSyntheticResult(call.id, allCallIds.get(call.id)) as T);
          seenResultIds.add(call.id);
          stats.syntheticResultsInserted++;
        }
      }
    }
  }

  // Any pending result left means the referenced call never appeared in stream ordering.
  // Drop as orphan to keep transcript valid and deterministic.
  if (pendingResults.size > 0) {
    stats.orphanResultsDropped += pendingResults.size;
  }

  stats.repaired = stats.syntheticResultsInserted > 0
    || stats.orphanResultsDropped > 0
    || stats.duplicateResultsDropped > 0
    || out.length !== messages.length
    || out.some((m, i) => m !== messages[i]);

  return {
    messages: stats.repaired ? out : messages,
    stats,
  };
}
