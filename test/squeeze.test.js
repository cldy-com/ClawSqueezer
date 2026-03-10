import { describe, it } from "node:test";
import assert from "node:assert";
import { squeeze } from "../dist/squeezer.js";

describe("ClawSqueezer", () => {
  // Simulate real conversation with heavy content
  const messages = [
    // Turn 1 — user sends image
    { role: "user", content: [
      { type: "text", text: "what do you see in this?" },
      { type: "image", data: "A".repeat(200_000) },
    ]},
    { role: "assistant", content: [
      { type: "text", text: "I can see a dashboard showing three panels..." },
    ]},

    // Turn 2 — tool reads a large file
    { role: "assistant", content: [
      { type: "toolCall", id: "tc_1", name: "read", input: { path: "/root/project/src/index.ts" } },
    ]},
    { role: "toolResult", content: [
      { type: "text", text: "x".repeat(40_000) },
    ]},
    { role: "assistant", content: [
      { type: "text", text: "I've read the file. The main issue is on line 45..." },
    ]},

    // Turn 3 — exec with big output
    { role: "assistant", content: [
      { type: "toolCall", id: "tc_2", name: "exec", input: { command: "npm run build 2>&1 && echo done" } },
    ]},
    { role: "toolResult", content: [
      { type: "text", text: "Building...\n" + "x".repeat(20_000) },
    ]},
    { role: "assistant", content: [
      { type: "text", text: "Build succeeded." },
    ]},

    // Turn 4 — web fetch
    { role: "assistant", content: [
      { type: "toolCall", id: "tc_3", name: "web_fetch", input: { url: "https://docs.example.com/api" } },
    ]},
    { role: "toolResult", content: [
      { type: "text", text: "# API Docs\n" + "x".repeat(20_000) },
    ]},
    { role: "assistant", content: [
      { type: "text", text: "According to the docs..." },
    ]},

    // Turn 5 — recent
    { role: "user", content: "now fix the bug" },
    { role: "assistant", content: [
      { type: "toolCall", id: "tc_4", name: "edit", input: { path: "/root/project/src/index.ts", old_string: "bug", new_string: "fix" } },
    ]},
    { role: "toolResult", content: [
      { type: "text", text: "Successfully edited" },
    ]},
    { role: "assistant", content: [
      { type: "text", text: "Fixed the bug on line 45." },
    ]},

    // Turn 6 — latest
    { role: "user", content: "looks good, what else?" },
  ];

  it("should squeeze old images", () => {
    const { stats } = squeeze(messages, { staleTurns: 3, imageAgeTurns: 2 });
    assert.strictEqual(stats.imagesEvicted, 1);
    assert.ok(stats.tokensFreed > 40_000, `Expected >40K tokens freed, got ${stats.tokensFreed}`);
  });

  it("should squeeze old toolResult messages", () => {
    // With staleTurns: 3, turns 1-3 are stale (6 user turns total, last 3 are recent)
    // Add extra user turns to push toolResults past staleness threshold
    const extended = [
      ...messages,
      { role: "user", content: "turn 7" },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: "turn 8" },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ];
    const { stats } = squeeze(extended, { staleTurns: 3, imageAgeTurns: 2, minTokensToSqueeze: 100 });
    assert.ok(stats.toolResultsEvicted >= 2, `Expected >=2 toolResults evicted, got ${stats.toolResultsEvicted}`);
  });

  it("should preserve recent content", () => {
    const { messages: squeezed } = squeeze(messages, { staleTurns: 3, imageAgeTurns: 2 });
    const last = squeezed[squeezed.length - 1];
    assert.strictEqual(last.content, "looks good, what else?");
  });

  it("should preserve toolCall type/id/name when squeezing", () => {
    const { messages: squeezed } = squeeze(messages, { staleTurns: 3, imageAgeTurns: 2 });
    // Find a squeezed toolCall
    for (const msg of squeezed) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.input?._squeezed) {
          // Type must still be toolCall, not "text"
          assert.strictEqual(block.type, "toolCall", "Squeezed toolCall must keep its type");
          assert.ok(block.id, "Squeezed toolCall must keep its id");
          assert.ok(block.name, "Squeezed toolCall must keep its name");
        }
      }
    }
  });

  it("should not touch messages when all are recent", () => {
    const recent = messages.slice(-4); // Just the last few
    const { stats } = squeeze(recent, { staleTurns: 3, imageAgeTurns: 2 });
    assert.strictEqual(stats.blocksEvicted, 0);
    assert.strictEqual(stats.tokensFreed, 0);
  });

  it("should squeeze both input and arguments fields on toolCalls", () => {
    const msgs = [
      { role: "user", content: "turn 1" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc_args", name: "exec", arguments: { command: "x".repeat(2000) } },
      ]},
      { role: "toolResult", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: "turn 2" },
      { role: "user", content: "turn 3" },
      { role: "user", content: "turn 4" },
      { role: "user", content: "turn 5" },
      { role: "user", content: "turn 6" },
    ];
    const { messages: squeezed, stats } = squeeze(msgs, { staleTurns: 3, minTokensToSqueeze: 50 });
    assert.ok(stats.toolCallsEvicted >= 1, `Expected toolCalls evicted, got ${stats.toolCallsEvicted}`);
    // Verify arguments was replaced
    const tc = squeezed.find(m => Array.isArray(m.content) && m.content.some(b => b.id === "tc_args"));
    if (tc && Array.isArray(tc.content)) {
      const block = tc.content.find(b => b.id === "tc_args");
      assert.ok(block.arguments?._squeezed, "arguments should be squeezed");
    }
  });

  it("should reduce total size significantly", () => {
    const before = JSON.stringify(messages).length;
    const { messages: squeezed } = squeeze(messages, { staleTurns: 3, imageAgeTurns: 2 });
    const after = JSON.stringify(squeezed).length;
    const reduction = ((1 - after / before) * 100);
    assert.ok(reduction > 50, `Expected >50% reduction, got ${reduction.toFixed(0)}%`);
    console.log(`  Size reduction: ${reduction.toFixed(0)}% (${before.toLocaleString()} → ${after.toLocaleString()} chars)`);
  });
});
