import { describe, it, expect } from "vitest";
import { repairToolPairing } from "../src/repair.js";

describe("Tool pairing repair", () => {
  it("should insert synthetic result for missing toolResult right after its call", () => {
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

    const callIndex = repaired.findIndex(
      (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b: any) => b.id === "tc_1"),
    );
    const syntheticIndex = repaired.findIndex(
      (m) => m.role === "toolResult" && m.toolCallId === "tc_1" && m.isError === true,
    );

    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(syntheticIndex).toBe(callIndex + 1);
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

  it("should move out-of-order toolResults to after matching toolCall", () => {
    const earlyResult = {
      role: "toolResult",
      toolCallId: "tc_1",
      content: [{ type: "text", text: "done" }],
    };

    const messages = [
      { role: "user", content: "do x" },
      earlyResult,
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc_1", name: "exec", input: { command: "echo hi" } }],
      },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ];

    const { messages: repaired, stats } = repairToolPairing(messages);
    expect(stats.repaired).toBe(true);

    const callIndex = repaired.findIndex(
      (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b: any) => b.id === "tc_1"),
    );
    const resultIndex = repaired.findIndex(
      (m) => m.role === "toolResult" && m.toolCallId === "tc_1",
    );

    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeGreaterThan(callIndex);
  });

  it("should drop toolResults for aborted assistant toolCalls", () => {
    const messages = [
      {
        role: "assistant",
        stopReason: "aborted",
        content: [{ type: "toolCall", id: "tc_abort", name: "exec", input: { command: "sleep 10" } }],
      },
      { role: "toolResult", toolCallId: "tc_abort", content: [{ type: "text", text: "late" }] },
      { role: "user", content: "retry" },
    ];

    const { messages: repaired, stats } = repairToolPairing(messages);
    expect(stats.orphanResultsDropped).toBe(1);
    expect(repaired.some((m) => m.role === "toolResult" && m.toolCallId === "tc_abort")).toBe(false);
  });
});
