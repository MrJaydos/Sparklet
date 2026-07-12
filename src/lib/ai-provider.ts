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

/** Generate a JSON response, falling back Gemini → Groq on quota/server errors. */
export async function generateJSON(prompt: string): Promise<GenerateResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!geminiKey && !groqKey) {
    throw new Error("No AI provider configured: set GEMINI_API_KEY and/or GROQ_API_KEY");
  }

  if (geminiKey) {
    try {
      return await generateWithGemini(prompt, geminiKey);
    } catch (e) {
      const status = e instanceof ProviderError ? e.status : 0;
      // 404 = model retired/renamed; still worth trying the other provider.
      const retryable = status === 429 || status === 404 || status >= 500 || status === 0;
      if (!groqKey || !retryable) throw e;
      console.warn(`  Gemini failed (${status}) — falling back to Groq`);
    }
  }
  return generateWithGroq(prompt, groqKey!);
}
