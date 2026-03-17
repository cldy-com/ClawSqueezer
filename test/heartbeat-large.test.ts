import { describe, it, expect } from "vitest";
import { squeeze } from "../src/squeezer.js";

describe("Heartbeat pruning", () => {
  it("should remove HEARTBEAT_OK pairs", () => {
    const messages = [
      { role: "user", content: "Read HEARTBEAT.md if it exists. Follow it strictly." },
      { role: "assistant", content: "HEARTBEAT_OK" },
      { role: "user", content: "Read HEARTBEAT.md if it exists. Follow it strictly." },
      { role: "assistant", content: "HEARTBEAT_OK" },
      { role: "user", content: "Hello, help me with something" },
      { role: "assistant", content: "Sure, how can I help?" },
    ];

    const { messages: result, stats } = squeeze(messages, { pruneHeartbeats: true });

    expect(stats.heartbeatsPruned).toBe(2);
    expect(result).toHaveLength(2); // only the real conversation
    expect(result[0].content).toBe("Hello, help me with something");
    expect(result[1].content).toBe("Sure, how can I help?");
  });

  it("should keep heartbeats with real content", () => {
    const messages = [
      { role: "user", content: "Read HEARTBEAT.md if it exists. Follow it strictly." },
      { role: "assistant", content: "Found urgent email from client — notifying you now." },
      { role: "user", content: "Read HEARTBEAT.md if it exists. Follow it strictly." },
      { role: "assistant", content: "HEARTBEAT_OK" },
    ];

    const { messages: result, stats } = squeeze(messages, { pruneHeartbeats: true });

    expect(stats.heartbeatsPruned).toBe(1); // only the OK one
    expect(result).toHaveLength(2); // the alert heartbeat stays
    expect(result[1].content).toBe("Found urgent email from client — notifying you now.");
  });

  it("should not prune when disabled", () => {
    const messages = [
      { role: "user", content: "Read HEARTBEAT.md" },
      { role: "assistant", content: "HEARTBEAT_OK" },
    ];

    const { messages: result, stats } = squeeze(messages, { pruneHeartbeats: false });

    expect(stats.heartbeatsPruned).toBe(0);
    expect(result).toHaveLength(2);
  });
});

describe("Large result truncation", () => {
  it("should truncate toolResult exceeding threshold", () => {
    const bigContent = "x".repeat(60000);
    const messages = [
      { role: "user", content: "read the file" },
      { role: "toolResult", content: [{ type: "text", text: bigContent }] },
      { role: "assistant", content: "Done" },
    ];

    const { messages: result, stats } = squeeze(messages, {
      largeResultThreshold: 50000,
      largeResultPreviewChars: 100,
    });

    expect(stats.largeResultsTruncated).toBe(1);
    const toolResult = result[1];
    expect(Array.isArray(toolResult.content)).toBe(true);
    const text = (toolResult.content as any[])[0].text;
    expect(text).toContain("large result truncated");
    expect(text).toMatch(/\d[\d,]+ chars/); // contains char count
    expect(text.length).toBeLessThan(500); // much smaller than 60K
  });

  it("should not truncate small results", () => {
    const messages = [
      { role: "user", content: "read" },
      { role: "toolResult", content: [{ type: "text", text: "short content" }] },
      { role: "assistant", content: "Done" },
    ];

    const { messages: result, stats } = squeeze(messages, { largeResultThreshold: 50000 });

    expect(stats.largeResultsTruncated).toBe(0);
    expect((result[1].content as any[])[0].text).toBe("short content");
  });

  it("should truncate regardless of age (not just stale)", () => {
    // Large result in the most recent turn — should still be truncated
    const bigContent = "y".repeat(80000);
    const messages = [
      { role: "user", content: "read this huge file" },
      { role: "toolResult", content: [{ type: "text", text: bigContent }] },
      { role: "assistant", content: "Got it" },
    ];

    const { messages: result, stats } = squeeze(messages, {
      staleTurns: 4, // recent = within 4 turns
      largeResultThreshold: 50000,
    });

    // Large truncation happens regardless of staleness
    expect(stats.largeResultsTruncated).toBe(1);
  });
});
