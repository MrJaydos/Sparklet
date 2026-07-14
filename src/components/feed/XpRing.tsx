"use client";

/**
 * Daily XP goal ring for the feed header: fills as today's XP approaches
 * the goal, turns gold when the goal is met.
 */
export function XpRing({ today, goal }: { today: number; goal: number }) {
  const progress = Math.min(1, today / goal);
  const done = today >= goal;
  const r = 8;
  const c = 2 * Math.PI * r;

  return (
    <span
      className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-neutral-900/80 py-1.5 pl-2 pr-2.5 text-xs font-semibold backdrop-blur"
      title={done ? `Daily goal reached — ${today} XP today` : `${today}/${goal} XP today`}
    >
      <span className="relative flex h-5 w-5 items-center justify-center">
        <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90">
          <circle cx="10" cy="10" r={r} fill="none" stroke="#262626" strokeWidth="2.5" />
          <circle
            cx="10"
            cy="10"
            r={r}
            fill="none"
            stroke={done ? "#f59e0b" : "#8b5cf6"}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - progress)}
            style={{ transition: "stroke-dashoffset 500ms ease, stroke 500ms ease" }}
          />
        </svg>
        <span className="absolute text-[8px] leading-none" aria-hidden>
          ⚡
        </span>
      </span>
      <span className={done ? "text-amber-300" : "text-neutral-200"}>
        {done ? today : `${today}/${goal}`}
      </span>
    </span>
  );
}
