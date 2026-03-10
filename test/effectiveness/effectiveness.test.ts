/**
 * 🍋 ClawSqueezer Effectiveness Tests
 *
 * Tests the plugin against real LLM APIs to verify:
 * 1. API compatibility — squeezed transcripts are accepted
 * 2. Token savings — measurable reduction in prompt tokens
 * 3. Quality — model can still reference squeezed content accurately
 *
 * Run: ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npx vitest run test/effectiveness/
 *
 * These tests cost real money (~$0.10-0.50 per run).
 * Skip with: npx vitest run --ignore test/effectiveness/
 */

import { describe, it, expect } from "vitest";
import { squeeze } from "../../src/squeezer.js";
import { repairToolPairing } from "../../src/repair.js";
import { codingSession, imageSession, mixedToolSession } from "./fixtures.js";

// ── Helpers ──

interface ModelConfig {
  name: string;
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  baseUrl: string;
}

/**
 * Configure models via environment variables:
 *
 * Direct API keys:
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   OPENAI_API_KEY=sk-...
 *
 * Custom/LiteLLM endpoint (OpenAI-compatible):
 *   TEST_API_KEY=your-key
 *   TEST_BASE_URL=http://localhost:4001    (default: https://api.openai.com)
 *   TEST_MODEL=cldy-chat-pro              (default: gpt-4o)
 *   TEST_NAME=LiteLLM                     (default: Custom)
 *
 * Multiple custom endpoints (comma-separated):
 *   TEST_MODELS=cldy-chat-pro,cldy-chat-master
 *   (uses same TEST_API_KEY and TEST_BASE_URL for all)
 */
function getModels(): ModelConfig[] {
  const models: ModelConfig[] = [];

  // Anthropic direct
  if (process.env.ANTHROPIC_API_KEY) {
    models.push({
      name: "Claude Sonnet",
      provider: "anthropic",
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    });
  }

  // OpenAI direct
  if (process.env.OPENAI_API_KEY && !process.env.TEST_API_KEY) {
    models.push({
      name: "GPT-4o",
      provider: "openai",
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com",
    });
  }

  // Custom / LiteLLM / any OpenAI-compatible endpoint
  if (process.env.TEST_API_KEY) {
    const baseUrl = process.env.TEST_BASE_URL ?? "https://api.openai.com";
    const key = process.env.TEST_API_KEY;
    const namePrefix = process.env.TEST_NAME ?? "Custom";

    const modelList = process.env.TEST_MODELS
      ? process.env.TEST_MODELS.split(",").map((m) => m.trim())
      : [process.env.TEST_MODEL ?? "gpt-4o"];

    for (const model of modelList) {
      models.push({
        name: modelList.length > 1 ? `${namePrefix}/${model}` : namePrefix,
        provider: "openai", // OpenAI-compatible format
        model,
        apiKey: key,
        baseUrl,
      });
    }
  }

  return models;
}

/** Convert our internal format to Anthropic API format */
function toAnthropicMessages(msgs: Record<string, unknown>[]): unknown[] {
  return msgs.map((m) => {
    if (m.role === "toolResult") {
      return {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.toolCallId,
          content: Array.isArray(m.content)
            ? (m.content as any[]).map((b) => ({ type: "text", text: b.text ?? "" }))
            : [{ type: "text", text: String(m.content ?? "") }],
          ...(m.isError ? { is_error: true } : {}),
        }],
      };
    }

    if (m.role === "assistant" && Array.isArray(m.content)) {
      return {
        role: "assistant",
        content: (m.content as any[]).filter((b) => b.type !== "thinking").map((b) => {
          if (b.type === "toolCall" || b.type === "tool_use") {
            return {
              type: "tool_use",
              id: b.id,
              name: b.name,
              input: b.input ?? b.arguments ?? {},
            };
          }
          return b;
        }),
      };
    }

    if (m.role === "user" && Array.isArray(m.content)) {
      return {
        role: "user",
        content: (m.content as any[]).filter((b) => b.type !== "image"),
      };
    }

    return { role: m.role, content: typeof m.content === "string" ? m.content : "..." };
  });
}

/** Convert our internal format to OpenAI API format */
function toOpenAIMessages(msgs: Record<string, unknown>[]): unknown[] {
  const result: unknown[] = [];

  for (const m of msgs) {
    if (m.role === "toolResult") {
      result.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: Array.isArray(m.content)
          ? (m.content as any[]).map((b) => b.text ?? "").join("\n")
          : String(m.content ?? ""),
      });
      continue;
    }

    if (m.role === "assistant" && Array.isArray(m.content)) {
      const textParts = (m.content as any[])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const toolCalls = (m.content as any[])
        .filter((b) => b.type === "toolCall" || b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input ?? b.arguments ?? {}),
          },
        }));

      const msg: Record<string, unknown> = { role: "assistant" };
      if (textParts) msg.content = textParts;
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      if (!textParts && toolCalls.length === 0) msg.content = "...";
      result.push(msg);
      continue;
    }

    if (m.role === "user") {
      const content = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? (m.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n") || "..."
          : "...";
      result.push({ role: "user", content });
      continue;
    }

    result.push({ role: m.role, content: typeof m.content === "string" ? m.content : "..." });
  }

  return result;
}

/** Call Anthropic API */
async function callAnthropic(config: ModelConfig, messages: unknown[]): Promise<{
  ok: boolean;
  promptTokens: number;
  outputTokens: number;
  response: string;
  error?: string;
}> {
  const tools = [{
    name: "exec", description: "Run shell command",
    input_schema: { type: "object", properties: { command: { type: "string" } } },
  }, {
    name: "write", description: "Write file",
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
  }, {
    name: "read", description: "Read file",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
  }, {
    name: "edit", description: "Edit file",
    input_schema: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } } },
  }];

  const res = await fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 200,
      system: "You are a helpful assistant. Answer concisely.",
      messages,
      tools,
    }),
  });

  const body = await res.json() as any;

  if (!res.ok) {
    return { ok: false, promptTokens: 0, outputTokens: 0, response: "", error: body.error?.message ?? JSON.stringify(body) };
  }

  const text = body.content?.find((b: any) => b.type === "text")?.text ?? "";
  return {
    ok: true,
    promptTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    response: text,
  };
}

/** Call OpenAI API */
async function callOpenAI(config: ModelConfig, messages: unknown[]): Promise<{
  ok: boolean;
  promptTokens: number;
  outputTokens: number;
  response: string;
  error?: string;
}> {
  const tools = [{
    type: "function",
    function: { name: "exec", description: "Run shell command", parameters: { type: "object", properties: { command: { type: "string" } } } },
  }, {
    type: "function",
    function: { name: "write", description: "Write file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } },
  }, {
    type: "function",
    function: { name: "read", description: "Read file", parameters: { type: "object", properties: { path: { type: "string" } } } },
  }, {
    type: "function",
    function: { name: "edit", description: "Edit file", parameters: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } } } },
  }];

  const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 200,
      messages: [{ role: "system", content: "You are a helpful assistant. Answer concisely." }, ...messages as any[]],
      tools,
    }),
  });

  const body = await res.json() as any;

  if (!res.ok) {
    return { ok: false, promptTokens: 0, outputTokens: 0, response: "", error: body.error?.message ?? JSON.stringify(body) };
  }

  return {
    ok: true,
    promptTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    response: body.choices?.[0]?.message?.content ?? "",
  };
}

async function callModel(config: ModelConfig, msgs: Record<string, unknown>[]) {
  if (config.provider === "anthropic") {
    return callAnthropic(config, toAnthropicMessages(msgs));
  }
  return callOpenAI(config, toOpenAIMessages(msgs));
}

// ── Tests ──

// Local sanity checks live in test/sanity.test.ts (runs in default npm test)

const models = getModels();

describe.skipIf(models.length === 0)("Effectiveness tests", () => {

  describe.each(models)("$name", (model) => {

    describe("API Compatibility", () => {
      it("should accept a squeezed coding session", async () => {
        const raw = codingSession(12);
        const { messages: squeezed } = squeeze(raw, { staleTurns: 3, minTokensToSqueeze: 50 });
        const { messages: repaired } = repairToolPairing(squeezed);

        // Append a question
        repaired.push({ role: "user", content: "What have we built so far? One sentence." } as any);

        const result = await callModel(model, repaired as any);
        expect(result.ok, `API rejected: ${result.error}`).toBe(true);
        expect(result.response.length).toBeGreaterThan(0);
      }, 30_000);

      it("should accept a squeezed image session", async () => {
        const raw = imageSession();
        const { messages: squeezed, stats } = squeeze(raw, { staleTurns: 2, imageAgeTurns: 1 });

        // Verify images were actually squeezed (prevents false-pass if squeeze regresses)
        expect(stats.imagesEvicted, "Image squeeze should have evicted at least 1 image").toBeGreaterThan(0);

        // Verify placeholder exists in squeezed output
        const hasPlaceholder = squeezed.some((m) =>
          Array.isArray(m.content) && (m.content as any[]).some((b) =>
            b.type === "text" && typeof b.text === "string" && b.text.includes("[image was here"),
          ),
        );
        expect(hasPlaceholder, "Squeezed output should contain image placeholder").toBe(true);

        const { messages: repaired } = repairToolPairing(squeezed);
        repaired.push({ role: "user", content: "What error did I show you earlier?" } as any);

        const result = await callModel(model, repaired as any);
        expect(result.ok, `API rejected: ${result.error}`).toBe(true);
      }, 30_000);

      it("should accept a squeezed mixed tool session", async () => {
        const raw = mixedToolSession();
        const { messages: squeezed } = squeeze(raw, { staleTurns: 3, minTokensToSqueeze: 50 });
        const { messages: repaired } = repairToolPairing(squeezed);

        repaired.push({ role: "user", content: "What did we deploy?" } as any);

        const result = await callModel(model, repaired as any);
        expect(result.ok, `API rejected: ${result.error}`).toBe(true);
      }, 30_000);
    });

    describe("Token Savings", () => {
      it("should measurably reduce prompt tokens", async () => {
        const raw = codingSession(12);

        // Unsqueezed baseline
        const rawCopy = [...raw, { role: "user", content: "Summarize what we did in one sentence." }];
        const baseline = await callModel(model, rawCopy as any);

        // Squeezed
        const { messages: squeezed } = squeeze(raw, { staleTurns: 3, minTokensToSqueeze: 50 });
        const { messages: repaired } = repairToolPairing(squeezed);
        repaired.push({ role: "user", content: "Summarize what we did in one sentence." } as any);
        const optimized = await callModel(model, repaired as any);

        expect(baseline.ok, `Baseline API failed: ${baseline.error}`).toBe(true);
        expect(optimized.ok, `Optimized API failed: ${optimized.error}`).toBe(true);

        const savings = ((baseline.promptTokens - optimized.promptTokens) / baseline.promptTokens) * 100;
        console.log(`  [${model.name}] Baseline: ${baseline.promptTokens} tokens | Squeezed: ${optimized.promptTokens} tokens | Savings: ${savings.toFixed(1)}%`);

        expect(optimized.promptTokens).toBeLessThan(baseline.promptTokens);
      }, 60_000);
    });

    describe("Quality", () => {
      it("should still know what tools were used", async () => {
        const raw = codingSession(12);
        const { messages: squeezed } = squeeze(raw, { staleTurns: 3, minTokensToSqueeze: 50 });
        const { messages: repaired } = repairToolPairing(squeezed);

        repaired.push({
          role: "user",
          content: "List the tool names that were used earlier in this conversation. Just the tool names, comma-separated.",
        } as any);

        const result = await callModel(model, repaired as any);
        expect(result.ok, `API rejected: ${result.error}`).toBe(true);

        const response = result.response.toLowerCase();
        // Should mention at least exec and write (the main tools used)
        const mentionsExec = response.includes("exec");
        const mentionsWrite = response.includes("write");
        console.log(`  [${model.name}] Quality check: mentions exec=${mentionsExec}, write=${mentionsWrite}`);
        console.log(`  [${model.name}] Response: "${result.response}"`);

        expect(mentionsExec || mentionsWrite, "Model should remember at least one tool name from squeezed context").toBe(true);
      }, 30_000);

      it("should know the project topic despite squeezing", async () => {
        const raw = codingSession(12);
        const { messages: squeezed } = squeeze(raw, { staleTurns: 3, minTokensToSqueeze: 50 });
        const { messages: repaired } = repairToolPairing(squeezed);

        repaired.push({
          role: "user",
          content: "What kind of application did we build? One word answer.",
        } as any);

        const result = await callModel(model, repaired as any);
        expect(result.ok, `API rejected: ${result.error}`).toBe(true);

        const response = result.response.toLowerCase();
        console.log(`  [${model.name}] Topic check: "${result.response}"`);

        // Should mention todo, api, rest, or express
        const relevant = ["todo", "api", "rest", "express"].some((w) => response.includes(w));
        expect(relevant, "Model should remember the project topic").toBe(true);
      }, 30_000);
    });
  });
});
