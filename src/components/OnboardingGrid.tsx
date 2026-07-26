"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OnboardingGrid({
  categories,
}: {
  categories: { id: string; slug: string; name: string; colorHex: string; icon: string }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<"name" | "interests">("name");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async (categoryIds: string[]) => {
    setBusy(true);
    try {
      if (name.trim()) {
        await fetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        }).catch(() => {});
      }
      await fetch("/api/interests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryIds }),
      });
      // Picks become the feed's topic selection (same as the topic picker) —
      // the feed pins to them, and the user can widen it anytime.
      const slugs = categories.filter((c) => categoryIds.includes(c.id)).map((c) => c.slug);
      try {
        localStorage.setItem("sparklet.categories", JSON.stringify(slugs));
      } catch {
        /* private mode */
      }
    } finally {
      router.push("/feed");
    }
  };

  if (step === "name") {
    return (
      <>
        <h1 className="text-3xl font-bold">What should we call you?</h1>
        <p className="mt-2 text-neutral-400">
          So the next screen can say hi properly. Totally optional.
        </p>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Your name"
          className="mt-6 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setStep("interests")}
          className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white transition hover:bg-violet-500"
        >
          {name.trim() ? "Continue" : "Skip"}
        </button>
      </>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-bold">
        {name.trim() ? `Okay, ${name.trim()}, what interests you?` : "What sparks your curiosity?"}
      </h1>
      <p className="mt-2 text-neutral-400">
        Pick at least 3 topics — your feed will show just these. You can widen
        or switch topics anytime from the feed.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {categories.map((c) => {
          const active = picked.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`rounded-xl border px-3 py-4 text-left text-sm font-medium transition ${
                active
                  ? "border-transparent text-white"
                  : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600"
              }`}
              style={active ? { backgroundColor: `${c.colorHex}40`, borderColor: c.colorHex } : undefined}
            >
              <span className="text-xl">{c.icon}</span>
              <div className="mt-1">{c.name}</div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={picked.length < 3 || busy}
        onClick={() => submit(picked)}
        className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white transition enabled:hover:bg-violet-500 disabled:opacity-40"
      >
        {picked.length < 3
          ? `Pick ${3 - picked.length} more`
          : `Start with ${picked.length} topics`}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => submit([])}
        className="mt-2 w-full rounded-xl px-4 py-3 text-sm text-neutral-500 transition hover:text-neutral-300"
      >
        Skip — show me everything
      </button>
    </>
  );
}
