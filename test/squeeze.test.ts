import { describe, it, expect } from "vitest";
import { squeeze, type SqueezerConfig } from "../src/squeezer.js";

describe("squeeze", () => {
  const bigToolResult = (id: string, size: number) => ({
    role: "toolResult" as const,
    toolCallId: id,
    content: [{ type: "text", text: "x".repeat(size) }],
  });

  const makeConversation = (stalePairs: number, recentTurns: number) => {
    const msgs: Record<string, unknown>[] = [];
    // Stale turns with tool calls
    for (let i = 0; i < stalePairs; i++) {
      msgs.push({ role: "user", content: `request ${i}` });
      msgs.push({
        role: "assistant",
        content: [
          { type: "toolCall", id: `tc_${i}`, name: "exec", input: { command: "x".repeat(1000) } },
        ],
      });
      msgs.push(bigToolResult(`tc_${i}`, 2000));
    }
    // Recent turns
    for (let j = 0; j < recentTurns; j++) {
      msgs.push({ role: "user", content: `recent ${j}` });
      msgs.push({ role: "assistant", content: [{ type: "text", text: `reply ${j}` }] });
    }
    return msgs;
  };

  it("should not touch recent messages", () => {
    const msgs = makeConversation(0, 3);
    const { messages, stats } = squeeze(msgs, { staleTurns: 4 });
    expect(stats.blocksEvicted).toBe(0);
  });

  it("should squeeze stale tool results", () => {
    const msgs = makeConversation(2, 5);
    const { stats } = squeeze(msgs, { staleTurns: 3, minTokensToSqueeze: 50 });
    expect(stats.toolResultsEvicted).toBeGreaterThan(0);
    expect(stats.tokensFreed).toBeGreaterThan(0);
  });

  it("should squeeze stale tool calls", () => {
    const msgs = makeConversation(2, 5);
    const { stats } = squeeze(msgs, { staleTurns: 3, minTokensToSqueeze: 50 });
    expect(stats.toolCallsEvicted).toBeGreaterThan(0);
  });

  it("should squeeze stale images", () => {
    const msgs = [
      { role: "user", content: "look at this" },
      {
        role: "assistant",
        content: [
          { type: "image", source: { type: "base64", data: "x".repeat(5000) } },
          { type: "text", text: "I see a cat" },
        ],
      },
      { role: "user", content: "turn 2" },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: "turn 3" },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: "turn 4" },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: "turn 5" },
    ];
    const { stats } = squeeze(msgs, { staleTurns: 2, imageAgeTurns: 2 });
    expect(stats.imagesEvicted).toBeGreaterThan(0);
  });

  it("should squeeze both input and arguments fields on toolCalls", () => {
    const msgs = [
      { role: "user", content: "turn 1" },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tc_args", name: "exec", arguments: { command: "x".repeat(2000) } },
        ],
      },
      { role: "toolResult", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: "turn 2" },
      { role: "user", content: "turn 3" },
      { role: "user", content: "turn 4" },
      { role: "user", content: "turn 5" },
      { role: "user", content: "turn 6" },
    ];
    const { messages, stats } = squeeze(msgs, { staleTurns: 3, minTokensToSqueeze: 50 });
    expect(stats.toolCallsEvicted).toBeGreaterThanOrEqual(1);

    const tc = messages.find(
      (m) => Array.isArray(m.content) && m.content.some((b: any) => b.id === "tc_args"),
    );
    if (tc && Array.isArray(tc.content)) {
      const block = tc.content.find((b: any) => b.id === "tc_args") as any;
      expect(block.arguments?._squeezed).toBe(true);
    }
  });

  it("should preserve message count", () => {
    const msgs = makeConversation(3, 4);
    const { messages } = squeeze(msgs, { staleTurns: 3, minTokensToSqueeze: 50 });
    expect(messages.length).toBe(msgs.length);
  });

  it("should reduce total size significantly", () => {
    const msgs = makeConversation(5, 3);
    const before = JSON.stringify(msgs).length;
    const { messages } = squeeze(msgs, { staleTurns: 2, minTokensToSqueeze: 50 });
    const after = JSON.stringify(messages).length;
    expect(after).toBeLessThan(before * 0.7); // at least 30% reduction
  });
});
