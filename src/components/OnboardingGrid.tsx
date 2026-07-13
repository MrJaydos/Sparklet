"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OnboardingGrid({
  categories,
}: {
  categories: { id: string; name: string; colorHex: string; icon: string }[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < 5 ? [...p, id] : p
    );

  const submit = async (categoryIds: string[]) => {
    setBusy(true);
    try {
      await fetch("/api/interests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryIds }),
      });
    } finally {
      router.push("/feed");
    }
  };

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
