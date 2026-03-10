/**
 * 🍋 ClawSqueezer — Stale content eviction for OpenClaw
 *
 * The problem: Images, tool results, and exec outputs stay in context
 * forever until compaction. One screenshot = 48K tokens. One file read = 10K.
 * Your actual messages? 3% of context. The overhead? 86%.
 *
 * The solution: assemble() scans messages before each LLM call and replaces
 * stale heavy content with tiny placeholders. Context stays lean. Compaction
 * fires 2-3x less often.
 *
 * What gets squeezed (only after N turns old):
 * - Images (base64)      → "[image, processed N turns ago]"
 * - Tool results (large)  → "[read file.ts — 500 lines]"
 * - Exec outputs          → "[exec: command, exit 0]"
 * - Web fetches           → "[fetched url — N chars]"
 * - Tool call arguments   → trimmed to summary
 */

export interface SqueezerConfig {
  /** Turns before content becomes eligible for eviction (default: 4) */
  staleTurns: number;
  /** Minimum token size to consider for eviction (default: 200) */
  minTokensToSqueeze: number;
  /** Keep last N characters of tool results as preview (default: 200) */
  keepPreviewChars: number;
  /** Squeeze images after this many turns (default: 2, they're huge) */
  imageAgeTurns: number;
}

const DEFAULT_CONFIG: SqueezerConfig = {
  staleTurns: 4,
  minTokensToSqueeze: 200,
  keepPreviewChars: 200,
  imageAgeTurns: 2,
};

interface ContentBlock {
  type: string;
  text?: string;
  data?: string;         // base64 image data (flat format)
  source?: { type?: string; data?: string; media_type?: string }; // base64 image (Anthropic format)
  name?: string;         // tool name
  id?: string;           // tool_use id
  tool_use_id?: string;  // tool_result reference
  content?: any;         // tool_result content
  input?: any;           // tool_use input
  arguments?: any;       // tool call arguments
  thinking?: string;     // thinking block
  [key: string]: unknown;
}

interface AgentMessage {
  role: string;
  content?: string | ContentBlock[];
  timestamp?: string | number;
  [key: string]: unknown;
}

/** Estimate tokens from text length */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Get the total size of a content block in characters */
function blockSize(block: ContentBlock): number {
  let size = 0;
  if (block.text) size += block.text.length;
  if (block.data) size += block.data.length;
  if (block.thinking) size += block.thinking.length;
  if (block.content) size += JSON.stringify(block.content).length;
  if (block.input) size += JSON.stringify(block.input).length;
  if (block.arguments) size += JSON.stringify(block.arguments).length;
  return size;
}

/** Extract a short description from a tool call */
function describeToolCall(block: ContentBlock): string {
  const name = block.name || "tool";
  const args = block.input || block.arguments || {};
  
  // Common tool patterns
  if (name === "exec") {
    const cmd = args.command || "";
    const short = typeof cmd === "string" ? cmd.slice(0, 80) : "...";
    return `[exec: ${short}]`;
  }
  if (name === "Read" || name === "read") {
    const path = args.file_path || args.path || "file";
    return `[read: ${path}]`;
  }
  if (name === "Write" || name === "write") {
    const path = args.file_path || args.path || "file";
    return `[write: ${path}]`;
  }
  if (name === "Edit" || name === "edit") {
    const path = args.file_path || args.path || "file";
    return `[edit: ${path}]`;
  }
  if (name === "web_fetch") {
    const url = args.url || "url";
    return `[fetched: ${url}]`;
  }
  if (name === "web_search") {
    const q = args.query || "query";
    return `[searched: ${q}]`;
  }
  if (name === "browser") {
    const action = args.action || "action";
    return `[browser: ${action}]`;
  }
  
  return `[${name}]`;
}

/** Extract a short description from a tool result */
function describeToolResult(block: ContentBlock, originalSize: number): string {
  const content = block.content;
  const chars = originalSize;
  const tokens = estimateTokens(String(content || "").slice(0, chars));
  
  // Try to extract meaningful preview
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const firstLine = text.split("\n")[0]?.slice(0, 80) || "";
  
  return `[tool result: ${chars.toLocaleString()} chars, ~${tokens.toLocaleString()} tokens — ${firstLine}]`;
}

/**
 * Squeeze a message array — replace stale heavy content with placeholders.
 *
 * @param messages - The message array from the session
 * @param config - Squeezer configuration
 * @returns New message array with stale content evicted, and stats
 */
export function squeeze(
  messages: AgentMessage[],
  config: Partial<SqueezerConfig> = {},
): { messages: AgentMessage[]; stats: SqueezeStats } {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const totalMessages = messages.length;

  const stats: SqueezeStats = {
    messagesProcessed: totalMessages,
    blocksEvicted: 0,
    tokensFreed: 0,
    imagesEvicted: 0,
    toolResultsEvicted: 0,
    toolCallsEvicted: 0,
  };

  // Build turn map: assign a "turns from end" value to each message index.
  // A "turn" = one user message + all subsequent assistant/tool messages until the next user message.
  // All messages in the same turn get the same age — fixes inconsistent aging
  // where user messages were counted as older than their paired assistant/tool messages.
  const turnAge: number[] = new Array(messages.length).fill(0);
  let totalUserTurns = 0;
  const userIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      userIndices.push(i);
      totalUserTurns++;
    }
  }

  // Assign turn age: messages before first user msg get highest age,
  // then each turn counts down from totalUserTurns to 1 (most recent).
  for (let t = 0; t < userIndices.length; t++) {
    const start = userIndices[t];
    const end = t + 1 < userIndices.length ? userIndices[t + 1] : messages.length;
    const age = totalUserTurns - t; // turns from end (1 = most recent user turn)
    for (let j = start; j < end; j++) {
      turnAge[j] = age;
    }
  }
  // Messages before the first user message get max age
  if (userIndices.length > 0) {
    for (let j = 0; j < userIndices[0]; j++) {
      turnAge[j] = totalUserTurns + 1;
    }
  }

  // Process each message
  const result: AgentMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // turnsFromEnd: how many user turns ago this message was
    const turnsFromEnd = turnAge[i];

    // Don't touch recent messages
    const isStale = turnsFromEnd > cfg.staleTurns;
    const isImageStale = turnsFromEnd > cfg.imageAgeTurns;

    // Handle toolResult role messages (OpenClaw format: role="toolResult", content=[blocks])
    // These are the biggest context hogs — 42% of context in production data.
    if (msg.role === "toolResult" && isStale && Array.isArray(msg.content)) {
      const totalSize = msg.content.reduce((sum: number, b: any) => {
        if (typeof b === "object" && b !== null) {
          return sum + (b.text?.length || 0) + (b.content?.length || 0) + (JSON.stringify(b).length || 0);
        }
        return sum + String(b).length;
      }, 0);

      if (totalSize > cfg.minTokensToSqueeze * 4) {
        // Extract preview from first text block
        const firstText = msg.content.find((b: any) => typeof b === "object" && b?.type === "text");
        const preview = firstText?.text?.slice(0, cfg.keepPreviewChars) || "";
        const freedTokens = Math.ceil(totalSize / 4) - Math.ceil((cfg.keepPreviewChars + 80) / 4);

        result.push({
          ...msg,
          content: [{
            type: "text",
            text: `[tool result squeezed — was ${totalSize.toLocaleString()} chars, ~${Math.ceil(totalSize / 4).toLocaleString()} tokens]\nPreview: ${preview}`,
          }],
        });
        stats.toolResultsEvicted++;
        stats.blocksEvicted++;
        stats.tokensFreed += Math.max(0, freedTokens);
        continue;
      }
    }

    // If content is a string, nothing to squeeze
    if (typeof msg.content === "string" || !Array.isArray(msg.content)) {
      result.push(msg);
      continue;
    }

    // Process content blocks
    let modified = false;
    const newBlocks: ContentBlock[] = [];

    for (const block of msg.content as ContentBlock[]) {
      const size = blockSize(block);
      const tokens = estimateTokens(size.toString().length > 0 ? String(size) : "");
      const actualTokens = Math.ceil(size / 4);

      // Image blocks — squeeze after imageAgeTurns
      // Images can be { type: "image", data: "..." } or { type: "image", source: { data: "..." } }
      const imageData = block.data ?? block.source?.data;
      if (block.type === "image" && imageData && isImageStale) {
        const freedTokens = Math.ceil(imageData.length / 4);
        newBlocks.push({
          type: "text",
          text: `[image was here — ${freedTokens.toLocaleString()} tokens, processed ${turnsFromEnd} turns ago]`,
        });
        stats.imagesEvicted++;
        stats.blocksEvicted++;
        stats.tokensFreed += freedTokens;
        modified = true;
        continue;
      }

      // Tool results — squeeze if stale and large
      if (block.type === "tool_result" && isStale && size > cfg.minTokensToSqueeze * 4) {
        const preview = typeof block.content === "string"
          ? block.content.slice(0, cfg.keepPreviewChars)
          : JSON.stringify(block.content).slice(0, cfg.keepPreviewChars);
        
        newBlocks.push({
          ...block,
          content: `${describeToolResult(block, size)}\nPreview: ${preview}`,
        });
        stats.toolResultsEvicted++;
        stats.blocksEvicted++;
        stats.tokensFreed += Math.ceil(size / 4) - Math.ceil((cfg.keepPreviewChars + 100) / 4);
        modified = true;
        continue;
      }

      // Tool calls — squeeze arguments if stale and large
      // CRITICAL: keep type/id/name intact so tool_result pairing is preserved.
      // Anthropic rejects requests when tool_result references a missing tool_use id.
      if ((block.type === "tool_use" || block.type === "toolCall") && isStale) {
        const inputSize = block.input ? JSON.stringify(block.input).length : 0;
        const argsSize = block.arguments ? JSON.stringify(block.arguments).length : 0;
        const argSize = inputSize + argsSize;
        
        if (argSize > cfg.minTokensToSqueeze * 4) {
          const desc = describeToolCall(block);
          const stub = { _squeezed: true, summary: desc };
          const squeezedBlock: ContentBlock = { ...block };
          // Replace whichever field(s) exist — don't leave unsqueezed payload
          if (block.input) squeezedBlock.input = stub;
          if (block.arguments) squeezedBlock.arguments = stub;
          newBlocks.push(squeezedBlock);
          stats.toolCallsEvicted++;
          stats.blocksEvicted++;
          stats.tokensFreed += Math.ceil(argSize / 4) - Math.ceil(JSON.stringify(stub).length / 4);
          modified = true;
          continue;
        }
      }

      // Keep everything else as-is
      newBlocks.push(block);
    }

    if (modified) {
      result.push({ ...msg, content: newBlocks });
    } else {
      result.push(msg);
    }
  }

  return { messages: result, stats };
}

export interface SqueezeStats {
  messagesProcessed: number;
  blocksEvicted: number;
  tokensFreed: number;
  imagesEvicted: number;
  toolResultsEvicted: number;
  toolCallsEvicted: number;
}
