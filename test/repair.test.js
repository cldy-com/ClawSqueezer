import { describe, it } from "node:test";
import assert from "node:assert";
import { repairToolPairing } from "../dist/repair.js";

describe("Tool pairing repair", () => {
  it("should insert synthetic result for missing toolResult", () => {
    const messages = [
      { role: "assistant", content: [
        { type: "toolCall", id: "tc_1", name: "exec", input: {} },
      ]},
      // No toolResult for tc_1!
      { role: "user", content: "next" },
    ];

    const { messages: repaired, stats } = repairToolPairing(messages);
    assert.strictEqual(stats.syntheticResultsInserted, 1);
    assert.strictEqual(stats.repaired, true);

    const synthetic = repaired.find(m => m.role === "toolResult" && m.toolCallId === "tc_1");
    assert.ok(synthetic, "Should have synthetic toolResult");
    assert.strictEqual(synthetic.isError, true);
  });

  it("should drop orphan toolResults", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "toolResult", toolCallId: "ghost_id", content: [{ type: "text", text: "orphan" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ];

    const { stats } = repairToolPairing(messages);
    assert.strictEqual(stats.orphanResultsDropped, 1);
    assert.strictEqual(stats.repaired, true);
  });

  it("should drop duplicate toolResults", () => {
    const messages = [
      { role: "assistant", content: [
        { type: "toolCall", id: "tc_1", name: "read", input: {} },
      ]},
      { role: "toolResult", toolCallId: "tc_1", content: [{ type: "text", text: "first" }] },
      { role: "toolResult", toolCallId: "tc_1", content: [{ type: "text", text: "duplicate" }] },
    ];

    const { messages: repaired, stats } = repairToolPairing(messages);
    assert.strictEqual(stats.duplicateResultsDropped, 1);
    assert.strictEqual(stats.repaired, true);

    const results = repaired.filter(m => m.role === "toolResult");
    assert.strictEqual(results.length, 1);
  });

  it("should not modify valid transcripts", () => {
    const messages = [
      { role: "user", content: "do something" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc_1", name: "exec", input: { command: "echo hi" } },
      ]},
      { role: "toolResult", toolCallId: "tc_1", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];

    const { messages: repaired, stats } = repairToolPairing(messages);
    assert.strictEqual(stats.repaired, false);
    assert.strictEqual(repaired, messages); // Same reference — no copy needed
  });

  it("should skip aborted assistant messages", () => {
    const messages = [
      { role: "assistant", stopReason: "error", content: [
        { type: "toolCall", id: "tc_1", name: "exec", input: {} },
      ]},
      { role: "user", content: "try again" },
    ];

    const { stats } = repairToolPairing(messages);
    assert.strictEqual(stats.syntheticResultsInserted, 0);
  });
});
