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
 *
 * Inspired by lossless-claw's transcript-repair.ts.
 * Simplified for ClawSqueezer's needs — we don't reorder, just validate and fix.
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

  // Phase 1: Collect all tool call ids from assistant messages
  const allCallIds = new Map<string, string | undefined>(); // id → toolName
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const call of extractToolCalls(msg)) {
      allCallIds.set(call.id, call.name);
    }
  }

  // If no tool calls, still check for orphan toolResults
  // (toolResults with no matching tool call should be dropped)

  // Phase 2: Collect all existing tool result ids
  const existingResultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "toolResult") continue;
    const id = getResultId(msg);
    if (id) existingResultIds.add(id);
  }

  // Phase 3: Build repaired output
  const seenResultIds = new Set<string>();
  const out: T[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Handle toolResult messages — check for orphans, duplicates
    if (msg.role === "toolResult") {
      const id = getResultId(msg);

      // Orphan — no matching tool call anywhere in the transcript
      if (!id || !allCallIds.has(id)) {
        stats.orphanResultsDropped++;
        continue;
      }

      // Duplicate — already seen this id
      if (seenResultIds.has(id)) {
        stats.duplicateResultsDropped++;
        continue;
      }

      seenResultIds.add(id);
      out.push(msg);
      continue;
    }

    // For assistant messages with tool calls, ensure all results exist
    if (msg.role === "assistant") {
      // Skip aborted/errored messages
      if (msg.stopReason === "error" || msg.stopReason === "aborted") {
        out.push(msg);
        continue;
      }

      const calls = extractToolCalls(msg);
      out.push(msg);

      if (calls.length > 0) {
        // Check which calls are missing results
        for (const call of calls) {
          if (!existingResultIds.has(call.id)) {
            // Insert synthetic result
            const synthetic = makeSyntheticResult(call.id, call.name);
            out.push(synthetic as T);
            seenResultIds.add(call.id);
            stats.syntheticResultsInserted++;
          }
        }
      }
      continue;
    }

    out.push(msg);
  }

  stats.repaired = stats.syntheticResultsInserted > 0
    || stats.orphanResultsDropped > 0
    || stats.duplicateResultsDropped > 0;

  return {
    messages: stats.repaired ? out : messages,
    stats,
  };
}
