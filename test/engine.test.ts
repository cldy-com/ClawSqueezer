import { describe, it, expect } from "vitest";
import { ClawSqueezer } from "../src/engine.js";

describe("ClawSqueezer engine (integration)", () => {
  it("should implement ContextEngine interface", () => {
    const engine = new ClawSqueezer({});
    expect(typeof engine.ingest).toBe("function");
    expect(typeof engine.assemble).toBe("function");
    expect(typeof engine.compact).toBe("function");
    expect(engine.info.id).toBe("clawsqueezer");
    expect(engine.info.ownsCompaction).toBe(false);
  });

  it("assemble should squeeze stale content and repair pairing", async () => {
    const engine = new ClawSqueezer({ staleTurns: 2, minTokensToSqueeze: 10, imageAgeTurns: 1 });

    const messages = [
      { role: "user", content: "old turn" },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tc_1",
            name: "exec",
            input: { command: "find / -name '*.log'" + "x".repeat(500) },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tc_1",
        content: [{ type: "text", text: "huge output ".repeat(200) }],
      },
      { role: "user", content: "turn 2" },
      { role: "assistant", content: [{ type: "text", text: "reply 2" }] },
      { role: "user", content: "turn 3" },
      { role: "assistant", content: [{ type: "text", text: "reply 3" }] },
      { role: "user", content: "turn 4" },
    ];

    const result = await engine.assemble({
      messages,
      systemPrompt: "you are helpful",
      modelId: "test-model",
      maxContextTokens: 100000,
    });

    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeGreaterThanOrEqual(0);

    const toolResult = result.messages.find((m: any) => m.toolCallId === "tc_1");
    if (toolResult && Array.isArray(toolResult.content)) {
      const textBlock = (toolResult.content as any[]).find((b) => b.type === "text");
      expect(textBlock.text.length).toBeLessThan(500);
    }
  });

  it("assemble should not modify recent messages", async () => {
    const engine = new ClawSqueezer({ staleTurns: 4 });

    const messages = [
      { role: "user", content: "only turn" },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
    ];

    const result = await engine.assemble({
      messages,
      systemPrompt: "test",
      modelId: "test-model",
      maxContextTokens: 100000,
    });

    expect(result.messages).toBe(messages);
    expect(result.estimatedTokens).toBe(0);
  });

  it("ingest should be a no-op", async () => {
    const engine = new ClawSqueezer({});
    const result = await engine.ingest({ role: "user", content: "test" });
    expect(result).toEqual({ ingested: false });
  });

  it("compact should defer to legacy", async () => {
    const engine = new ClawSqueezer({});
    const result = await engine.compact({
      messages: [],
      systemPrompt: "test",
      modelId: "test-model",
      maxContextTokens: 100000,
    });
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(false);
  });
});
