import { describe, it, expect } from "vitest";
import { repairToolPairing } from "../src/repair.js";

describe("Tool pairing repair", () => {
  it("should insert synthetic result for missing toolResult", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc_1", name: "exec", input: {} }],
      },
      { role: "user", content: "next" },
    ];

    const { messages: repaired, stats } = repairToolPairing(messages);
    expect(stats.syntheticResultsInserted).toBe(1);
    expect(stats.repaired).toBe(true);

    const synthetic = repaired.find((m) => m.role === "toolResult" && m.toolCallId === "tc_1");
    expect(synthetic).toBeDefined();
    expect(synthetic!.isError).toBe(true);
  });

  it("should drop orphan toolResults", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "toolResult", toolCallId: "ghost_id", content: [{ type: "text", text: "orphan" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ];

    const { stats } = repairToolPairing(messages);
    expect(stats.orphanResultsDropped).toBe(1);
    expect(stats.repaired).toBe(true);
  });

  it("should drop duplicate toolResults", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc_1", name: "read", input: {} }],
      },
      { role: "toolResult", toolCallId: "tc_1", content: [{ type: "text", text: "first" }] },
      { role: "toolResult", toolCallId: "tc_1", content: [{ type: "text", text: "duplicate" }] },
    ];

    const { messages: repaired, stats } = repairToolPairing(messages);
    expect(stats.duplicateResultsDropped).toBe(1);
    expect(stats.repaired).toBe(true);

    const results = repaired.filter((m) => m.role === "toolResult");
    expect(results.length).toBe(1);
  });

  it("should not modify valid transcripts", () => {
    const messages = [
      { role: "user", content: "do something" },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc_1", name: "exec", input: { command: "echo hi" } }],
      },
      { role: "toolResult", toolCallId: "tc_1", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];

    const { messages: repaired, stats } = repairToolPairing(messages);
    expect(stats.repaired).toBe(false);
    expect(repaired).toBe(messages); // same reference
  });

  it("should skip aborted assistant messages", () => {
    const messages = [
      {
        role: "assistant",
        stopReason: "error",
        content: [{ type: "toolCall", id: "tc_1", name: "exec", input: {} }],
      },
      { role: "user", content: "try again" },
    ];

    const { stats } = repairToolPairing(messages);
    expect(stats.syntheticResultsInserted).toBe(0);
  });
});
