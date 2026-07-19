"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  "Shuffling your feed…",
  "Dusting off some facts…",
  "Queuing up something good…",
  "Almost there…",
];

export default function Loading() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % MESSAGES.length), 1400);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-500">
      <div className="animate-bounce text-5xl">✨</div>
      <p className="text-sm font-medium text-neutral-400">{MESSAGES[i]}</p>
    </div>
  );
}
