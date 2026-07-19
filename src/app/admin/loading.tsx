import { SkeletonHeader } from "@/components/SkeletonHeader";

export default function Loading() {
  return (
    <>
      <SkeletonHeader />
      <main className="mx-auto min-h-dvh w-full max-w-2xl px-5 pb-8 pt-[calc(env(safe-area-inset-top)+4rem)]">
        <div className="h-7 w-24 animate-pulse rounded bg-neutral-800" />

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-900" />
          ))}
        </div>

        <div className="mt-8 h-5 w-40 animate-pulse rounded bg-neutral-800" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-neutral-900" />
          ))}
        </div>
      </main>
    </>
  );
}
