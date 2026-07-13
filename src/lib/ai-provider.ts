/**
 * Provider-agnostic LLM wrapper for content generation scripts.
 * Tries Gemini first (free tier, 1,500 req/day); falls back to Groq
 * (Llama 3.3 70B) on 429/5xx or when no Gemini key is configured.
 *
 * Used ONLY by standalone scripts (scripts/generate-content.ts) — never from
 * the running web app, keeping API keys and cost control out of the request
 * path.
 */

// "-latest" alias tracks the current stable Flash release — pinned versions
// get retired for new users (gemini-2.5-flash 404s as of mid-2026).
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

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

async function generateWithGemini(prompt: string, apiKey: string): Promise<GenerateResult> {
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
      signal: AbortSignal.timeout(120_000),
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
 */
export async function generateJSON(prompt: string): Promise<GenerateResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!geminiKey && !groqKey) {
    throw new Error("No AI provider configured: set GEMINI_API_KEY and/or GROQ_API_KEY");
  }

  let lastError: unknown;
  if (geminiKey) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await generateWithGemini(prompt, geminiKey);
      } catch (e) {
        lastError = e;
        const status = e instanceof ProviderError ? e.status : 0;
        // 404 = model retired/renamed — retrying won't help, go to fallback.
        if (status === 404) break;
        const retryable = status === 429 || status >= 500 || status === 0;
        if (!retryable) throw e;
        if (attempt < 3) {
          const wait = attempt * 30_000;
          console.warn(`  Gemini ${status} — retrying in ${wait / 1000}s (attempt ${attempt + 1}/3)`);
          await sleep(wait);
        }
      }
    }
    if (!groqKey) throw lastError;
    console.warn(`  Gemini exhausted retries — falling back to Groq`);
  }
  return generateWithGroq(prompt, groqKey!);
}
