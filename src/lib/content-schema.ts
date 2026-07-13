import { z } from "zod";
import { createHash } from "crypto";

export const sourceSchema = z.object({
  title: z.string().min(3),
  publisher: z.string().min(2),
  url: z.string().url(),
});

export const cardSchema = z.object({
  category: z.string().min(2), // category slug
  type: z.enum(["TEXT_IMAGE", "VIDEO"]).default("TEXT_IMAGE"),
  title: z.string().min(5).max(120),
  body: z.string().min(40).max(700), // ~40-80 words
  imageUrl: z.string().url().optional(),
  // Alternative to imageUrl: the importer resolves this Wikipedia article's
  // lead image at import time (verifiable, free, no fabricated URLs).
  imageWikipediaTitle: z.string().optional(),
  sources: z.array(sourceSchema).min(1).max(3),
  readMoreUrl: z.string().url(),
});

export const quizSchema = z.object({
  cardIndex: z.number().int().min(0), // index into the same file's cards[]
  question: z.string().min(10).max(200),
  options: z.array(z.string().min(1).max(120)).min(3).max(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(10).max(300),
});

export const contentFileSchema = z.object({
  generatedAt: z.string(),
  model: z.string().optional(),
  cards: z.array(cardSchema),
  quizzes: z.array(quizSchema).optional(),
});

export type QuizInput = z.infer<typeof quizSchema>;

export type CardInput = z.infer<typeof cardSchema>;
export type ContentFile = z.infer<typeof contentFileSchema>;

export function contentHash(card: Pick<CardInput, "category" | "title" | "body">) {
  return createHash("sha256")
    .update(`${card.category}\n${card.title}\n${card.body}`)
    .digest("hex");
}
