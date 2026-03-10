/**
 * 🍋 Local effectiveness sanity checks (no API keys needed).
 * Runs in default `npm test` to catch squeeze regressions.
 */

import { describe, it, expect } from "vitest";
import { squeeze } from "../src/squeezer.js";
import { repairToolPairing } from "../src/repair.js";
import { codingSession, imageSession, mixedToolSession } from "./effectiveness/fixtures.js";

describe("Local effectiveness sanity checks", () => {
  it("codingSession should achieve >30% size reduction", () => {
    const raw = codingSession(12);
    const before = JSON.stringify(raw).length;
    const { messages: squeezed, stats } = squeeze(raw, { staleTurns: 3, minTokensToSqueeze: 50 });
    const { messages: repaired } = repairToolPairing(squeezed);
    const after = JSON.stringify(repaired).length;
    const reduction = ((before - after) / before) * 100;

    console.log(`  [Local] codingSession: ${before} → ${after} chars (${reduction.toFixed(1)}% reduction)`);
    console.log(`  [Local] Stats: ${stats.blocksEvicted} blocks, ~${stats.tokensFreed} tokens freed`);

    expect(reduction).toBeGreaterThan(30);
    expect(stats.blocksEvicted).toBeGreaterThan(0);
  });

  it("imageSession should evict images and achieve size reduction", () => {
    const raw = imageSession();
    const before = JSON.stringify(raw).length;
    const { messages: squeezed, stats } = squeeze(raw, { staleTurns: 2, imageAgeTurns: 1 });
    const after = JSON.stringify(squeezed).length;
    const reduction = ((before - after) / before) * 100;

    console.log(`  [Local] imageSession: ${before} → ${after} chars (${reduction.toFixed(1)}% reduction)`);
    console.log(`  [Local] Images evicted: ${stats.imagesEvicted}`);

    expect(stats.imagesEvicted).toBeGreaterThan(0);
    expect(reduction).toBeGreaterThan(50);
  });

  it("mixedToolSession should squeeze stale tool outputs", () => {
    const raw = mixedToolSession();
    const before = JSON.stringify(raw).length;
    const { messages: squeezed, stats } = squeeze(raw, { staleTurns: 3, minTokensToSqueeze: 50 });
    const after = JSON.stringify(squeezed).length;
    const reduction = ((before - after) / before) * 100;

    console.log(`  [Local] mixedToolSession: ${before} → ${after} chars (${reduction.toFixed(1)}% reduction)`);
    console.log(`  [Local] Stats: toolResults=${stats.toolResultsEvicted}, toolCalls=${stats.toolCallsEvicted}`);

    expect(stats.toolResultsEvicted).toBeGreaterThan(0);
    expect(reduction).toBeGreaterThan(10);
  });

  it("repair should not break valid squeezed transcripts", () => {
    const raw = codingSession(12);
    const { messages: squeezed } = squeeze(raw, { staleTurns: 3, minTokensToSqueeze: 50 });
    const { messages: repaired, stats } = repairToolPairing(squeezed);

    expect(stats.orphanResultsDropped).toBe(0);
    expect(stats.duplicateResultsDropped).toBe(0);
    expect(repaired.length).toBe(squeezed.length);
  });
});
