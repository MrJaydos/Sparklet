import type { Article } from "@/lib/article";

/**
 * The long-form article on /card/[id]. Renders the stored structured JSON
 * through real elements — no markdown, no dangerouslySetInnerHTML — because
 * the content is model-generated (see src/lib/article.ts).
 */
export function CardArticle({ article }: { article: Article }) {
  return (
    <div className="mt-8 border-t border-neutral-800 pt-6">
      {article.sections.map((section, i) => (
        <section key={i} className="mb-7">
          <h2 className="text-lg font-bold leading-snug text-neutral-100">
            {section.heading}
          </h2>
          {section.paragraphs.map((p, j) => (
            <p key={j} className="mt-3 leading-relaxed text-neutral-300">
              {p}
            </p>
          ))}
        </section>
      ))}

      {article.keyTakeaways.length > 0 && (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-400">
            Key takeaways
          </h2>
          <ul className="mt-3 space-y-2">
            {article.keyTakeaways.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-neutral-300">
                <span aria-hidden className="text-violet-400">
                  •
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
