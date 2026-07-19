/**
 * Provider-agnostic LLM wrapper. Tries Gemini first (paid key as of
 * 2026-07-19 — prior default was the free tier's ~10 req/min, ~250 req/day
 * for Flash); falls back to Groq (Llama 3.3 70B) on 429/5xx or when no
 * Gemini key is configured. Scheduled scripts still cap their own volume
 * (TOPUP_MAX_CATEGORIES, ENRICH_MAX_PER_RUN) so a day's scripted calls leave
 * quota for interactive depth requests — raised, not removed, since paid
 * quota is large but not infinite.
 *
 * Two callers with different latency needs:
 *  - content scripts (scripts/generate-content.ts): patient, retry Gemini
 *    with backoff before falling back — daily quota recovers.
 *  - the depth-variant route (a user is waiting on a button): pass
 *    `interactive: true` to swap to Groq instantly on the first failure.
 *
 * submitBatch/listBatches/deleteBatch/batchResults wrap Gemini's batch mode
 * (async, ~half price) via the @google/genai SDK — used only by the nightly
 * --top-up run, which isn't waiting on anyone. Not used for the interactive
 * depth route or cross-verification (those need an answer this deploy, not
 * within 24h).
 */

// "-latest" alias tracks the current stable Flash release — pinned versions
// get retired for new users (gemini-2.5-flash 404s as of mid-2026).
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// Batch mode (scripts/generate-content.ts --top-up only — see submitBatch
// below) runs the same model at half the per-token price, in exchange for
// async turnaround (target 24h, usually much faster). Not used for the
// interactive depth route or cross-verification, which need an answer now.
let batchClient: GoogleGenAI | null | undefined;
function getBatchClient(): GoogleGenAI | null {
  if (batchClient !== undefined) return batchClient;
  const apiKey = process.env.GEMINI_API_KEY;
  batchClient = apiKey ? new GoogleGenAI({ apiKey }) : null;
  return batchClient;
}

import { GoogleGenAI, type BatchJob } from "@google/genai";

export type GenerateResult = { text: string; model: string };

class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    body: string
  ) {
    super(`${provider} returned ${status}: ${body.slice(0, 300)}`);
  }
}

async function generateWithGemini(
  prompt: string,
  apiKey: string,
  timeoutMs = 120_000
): Promise<GenerateResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    }
  );
  if (!res.ok) throw new ProviderError("gemini", res.status, await res.text());
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new ProviderError("gemini", 500, `unexpected response shape: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { text, model: GEMINI_MODEL };
}

async function generateWithGroq(prompt: string, apiKey: string): Promise<GenerateResult> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new ProviderError("groq", res.status, await res.text());
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new ProviderError("groq", 500, `unexpected response shape: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { text, model: GROQ_MODEL };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Embed text via Gemini (used for near-duplicate detection at import).
 * Returns null when no Gemini key is configured — callers must treat the
 * check as skipped, not failed.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  for (let retry = 0; retry < 3; retry++) {
    try {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            content: { parts: [{ text }] },
            outputDimensionality: 768,
          }),
          signal: AbortSignal.timeout(30_000),
        }
      );
      if (res.status === 429 || res.status >= 500) {
        await sleep(3_000 * (retry + 1));
        continue;
      }
      if (!res.ok) return null;
      const data = await res.json();
      const values = data?.embedding?.values;
      return Array.isArray(values) ? values : null;
    } catch {
      if (retry < 2) await sleep(2_000);
    }
  }
  return null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Which provider should independently verify a card: the one that did NOT
 * generate it. Returns null when that provider's key isn't configured.
 */
export function verifierFor(modelUsed: string | null | undefined): "gemini" | "groq" | null {
  const generatedByGemini = (modelUsed ?? "").toLowerCase().includes("gemini");
  if (generatedByGemini) return process.env.GROQ_API_KEY ? "groq" : null;
  return process.env.GEMINI_API_KEY ? "gemini" : null;
}

/** Run a JSON prompt against one specific provider (for cross-verification). */
export async function generateJSONWith(provider: "gemini" | "groq", prompt: string): Promise<GenerateResult> {
  if (provider === "gemini") return generateWithGemini(prompt, process.env.GEMINI_API_KEY!);
  return generateWithGroq(prompt, process.env.GROQ_API_KEY!);
}

/**
 * Generate a JSON response. Retries Gemini with backoff on rate limits
 * (free tier is easy to trip when generating many categories in a row),
 * then falls back to Groq if configured.
 *
 * `interactive: true` (someone is waiting on the response): one Gemini
 * attempt with a short timeout, then straight to Groq — no backoff sleeps.
 */
export async function generateJSON(
  prompt: string,
  opts?: { interactive?: boolean }
): Promise<GenerateResult> {
  const interactive = opts?.interactive ?? false;
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!geminiKey && !groqKey) {
    throw new Error("No AI provider configured: set GEMINI_API_KEY and/or GROQ_API_KEY");
  }

  let lastError: unknown;
  if (geminiKey) {
    const attempts = interactive ? 1 : 3;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await generateWithGemini(prompt, geminiKey, interactive ? 20_000 : 120_000);
      } catch (e) {
        lastError = e;
        const status = e instanceof ProviderError ? e.status : 0;
        // 404 = model retired/renamed — retrying won't help, go to fallback.
        if (status === 404) break;
        const retryable = status === 429 || status >= 500 || status === 0;
        if (!retryable) throw e;
        if (attempt < attempts) {
          const wait = attempt * 30_000;
          console.warn(`  Gemini ${status} — retrying in ${wait / 1000}s (attempt ${attempt + 1}/${attempts})`);
          await sleep(wait);
        }
      }
    }
    if (!groqKey) throw lastError;
    console.warn(
      interactive
        ? `  Gemini unavailable — switching to Groq immediately`
        : `  Gemini exhausted retries — falling back to Groq`
    );
  }
  return generateWithGroq(prompt, groqKey!);
}

export type BatchRequestItem = { key: string; prompt: string };

/**
 * Submit one batch job containing all given prompts as inline requests
 * (one Gemini call each, run server-side as a group). Returns the batch's
 * resource name (e.g. "batches/abc123") for later polling via listBatches.
 * Throws if no Gemini key is configured — callers should check
 * batchingAvailable() first and fall back to generateJSON per-item otherwise.
 */
export async function submitBatch(requests: BatchRequestItem[], displayName: string): Promise<string> {
  const client = getBatchClient();
  if (!client) throw new Error("Batch mode requires GEMINI_API_KEY");
  const job = await client.batches.create({
    model: GEMINI_MODEL,
    src: requests.map((r) => ({
      contents: [{ parts: [{ text: r.prompt }] }],
      config: { temperature: 0.9, responseMimeType: "application/json" },
      metadata: { key: r.key },
    })),
    config: { displayName },
  });
  if (!job.name) throw new Error(`Gemini batch create returned no job name: ${JSON.stringify(job)}`);
  return job.name;
}

export function batchingAvailable(): boolean {
  return getBatchClient() !== null;
}

/** All batch jobs whose displayName starts with `prefix`, most recent first isn't guaranteed — check createTime if order matters. */
export async function listBatches(prefix: string): Promise<BatchJob[]> {
  const client = getBatchClient();
  if (!client) return [];
  const jobs: BatchJob[] = [];
  const pager = await client.batches.list({ config: { pageSize: 20 } });
  for await (const job of pager) {
    if (job.displayName?.startsWith(prefix)) jobs.push(job);
  }
  return jobs;
}

/**
 * Fetch the full batch job by name. Required before reading results:
 * batches.list() returns summaries only (state, displayName — no
 * dest.inlinedResponses), even for a job in a terminal state. Only
 * batches.get() on a specific job returns the actual output.
 */
export async function getBatch(name: string): Promise<BatchJob | null> {
  const client = getBatchClient();
  if (!client) return null;
  return client.batches.get({ name });
}

export async function deleteBatch(name: string): Promise<void> {
  const client = getBatchClient();
  if (!client) return;
  await client.batches.delete({ name });
}

export type BatchResult = {
  key: string;
  text: string | null;
  error: string | null;
  finishReason?: string;
  raw?: unknown;
};

/** Per-request results from a completed (SUCCEEDED/PARTIALLY_SUCCEEDED) inline batch job. */
export function batchResults(job: BatchJob): BatchResult[] {
  const responses = job.dest?.inlinedResponses ?? [];
  return responses.map((r) => ({
    key: r.metadata?.key ?? "",
    text: r.response?.text ?? null,
    error: r.error?.message ?? (r.response?.text ? null : "empty response"),
    finishReason: r.response?.candidates?.[0]?.finishReason as string | undefined,
    raw: r.response,
  }));
}
