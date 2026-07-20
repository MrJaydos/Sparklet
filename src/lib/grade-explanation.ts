import { z } from "zod";
import { generateJSON } from "@/lib/ai-provider";

const gradeSchema = z.object({
  score: z.number().min(0).max(1),
  feedback: z.string().min(1).max(300),
});

export type ExplanationGrade = z.infer<typeof gradeSchema>;

/**
 * Grades a user's free-text explanation against the card's own body — the
 * card IS the ground truth here (unlike crossVerify in seed-content.ts,
 * which re-fetches external source text at import time). Runs interactively
 * from a live request (see the depth route for precedent): one fast Gemini
 * attempt, immediate Groq fallback, no background retry loop. Throws on any
 * failure — the caller is a route with a real user waiting, so "skip if
 * unsure" (crossVerify's pattern) is wrong here; a real score must come back
 * or the request fails loudly (502).
 */
export async function gradeExplanation(
  card: { title: string; body: string },
  userText: string
): Promise<ExplanationGrade> {
  const prompt = `A learner just read this fact and is explaining it back in their own words, to test whether they actually understood it (not whether they memorized the wording).

FACT TITLE: ${card.title}
FACT BODY: ${card.body}

LEARNER'S EXPLANATION: ${userText}

Judge whether the explanation captures the core idea — approximate numbers and looser phrasing are fine; a fabricated or reversed claim is not. Respond with JSON only: {"score": <0.0-1.0>, "feedback": "<one encouraging line, under 200 chars, naming what was right or what was missed>"}
- 1.0: fully captures the core idea, no fabrication.
- 0.5-0.8: gets the gist but misses or blurs a key detail.
- 0.0-0.3: misunderstands, reverses, or invents a claim not in the fact.`;

  const result = await generateJSON(prompt, { interactive: true });
  return gradeSchema.parse(JSON.parse(result.text));
}
