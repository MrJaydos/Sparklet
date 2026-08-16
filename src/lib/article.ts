import { z } from "zod";

/**
 * Long-form companion articles for /card/[id].
 *
 * Why this exists: the feed's swipe unit is a ~60-word card body, and a page
 * containing only that is thin content — ~1,300 such pages is what a "low
 * value content" review sees. The feed keeps its short cards; the *page*
 * carries a real article, and pages without one are noindex + kept out of
 * the sitemap rather than published thin.
 *
 * Structured JSON rather than markdown on purpose: the app ships no markdown
 * renderer, and the alternative — dangerouslySetInnerHTML over model output —
 * is an XSS surface. Sections render through real <h2>/<p> elements.
 */

export const articleSectionSchema = z.object({
  heading: z.string().min(3).max(120),
  paragraphs: z.array(z.string().min(40).max(2000)).min(1).max(6),
});

export const articleSchema = z.object({
  sections: z.array(articleSectionSchema).min(3).max(8),
  keyTakeaways: z.array(z.string().min(20).max(300)).min(2).max(5),
});

export type Article = z.infer<typeof articleSchema>;

/**
 * Below this, a card page is not meaningfully better than the bare 60-word
 * body it replaces, so it stays out of the index. Generation targets well
 * above it (see scripts/generate-articles.ts) — this is the floor that
 * decides indexability, not the target.
 */
export const ARTICLE_MIN_WORDS = 600;

export function countArticleWords(article: Article): number {
  const text = [
    ...article.sections.flatMap((s) => [s.heading, ...s.paragraphs]),
    ...article.keyTakeaways,
  ].join(" ");
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The single indexability test, shared by the card page's robots meta and
 * the sitemap so the two can never disagree — a URL in the sitemap that
 * serves noindex is its own crawl-quality problem.
 */
export function isIndexable(card: {
  published: boolean;
  depthLevel: string;
  articleWords: number | null;
}): boolean {
  return (
    card.published &&
    card.depthLevel === "STANDARD" &&
    (card.articleWords ?? 0) >= ARTICLE_MIN_WORDS
  );
}

/** Parse a stored article JSON blob, returning null if it's absent/malformed. */
export function parseArticle(value: unknown): Article | null {
  if (!value) return null;
  const parsed = articleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
