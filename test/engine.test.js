import { describe, it } from "node:test";
import assert from "node:assert";
import { ClawSqueezer } from "../dist/engine.js";

describe("ClawSqueezer engine (integration)", () => {
  it("should implement ContextEngine interface", () => {
    const engine = new ClawSqueezer({});
    // Required methods
    assert.strictEqual(typeof engine.ingest, "function");
    assert.strictEqual(typeof engine.assemble, "function");
    assert.strictEqual(typeof engine.compact, "function");
    // Info
    assert.strictEqual(engine.info.id, "clawsqueezer");
    assert.strictEqual(engine.info.ownsCompaction, false);
  });

  it("assemble should squeeze stale content and repair pairing", async () => {
    const engine = new ClawSqueezer({ staleTurns: 2, minTokensToSqueeze: 10, imageAgeTurns: 1 });

    const messages = [
      // Old turn — should be squeezed
      { role: "user", content: "old turn" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc_1", name: "exec",
          input: { command: "find / -name '*.log' -exec cat {} +" + "x".repeat(500) } },
      ]},
      { role: "toolResult", toolCallId: "tc_1", content: [
        { type: "text", text: "huge output ".repeat(200) },
      ]},
      // Recent turns
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

    assert.ok(result.messages, "Should return messages");
    assert.ok(result.messages.length > 0, "Should have messages");
    assert.ok(result.estimatedTokens >= 0, "Should report estimated tokens");

    // Verify the old toolResult was squeezed
    const toolResult = result.messages.find(m => m.toolCallId === "tc_1");
    if (toolResult && Array.isArray(toolResult.content)) {
      const textBlock = toolResult.content.find(b => b.type === "text");
      assert.ok(
        textBlock.text.includes("[squeezed]") || textBlock.text.length < 500,
        "Old toolResult should be squeezed",
      );
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

    // Nothing stale — should return originals unchanged
    assert.strictEqual(result.messages, messages, "Should return same reference when nothing squeezed");
    assert.strictEqual(result.estimatedTokens, 0);
  });

  it("ingest should be a no-op", async () => {
    const engine = new ClawSqueezer({});
    const result = await engine.ingest({
      role: "user",
      content: "test",
    });
    assert.deepStrictEqual(result, { ingested: false });
  });

  it("compact should defer to legacy (compacted: false)", async () => {
    const engine = new ClawSqueezer({});
    const result = await engine.compact({
      messages: [],
      systemPrompt: "test",
      modelId: "test-model",
      maxContextTokens: 100000,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.compacted, false);
  });
});
