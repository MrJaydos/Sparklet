import { SkeletonHeader } from "@/components/SkeletonHeader";

export default function Loading() {
  return (
    <>
      <SkeletonHeader />
      <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-[calc(env(safe-area-inset-top)+4rem)]">
        <div className="h-7 w-40 animate-pulse rounded bg-neutral-800" />

        <div className="mt-4 flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 w-24 animate-pulse rounded-full bg-neutral-900" />
          ))}
        </div>

        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl bg-neutral-900 p-3"
            >
              <div className="h-6 w-6 animate-pulse rounded-full bg-neutral-800" />
              <div className="h-4 flex-1 animate-pulse rounded bg-neutral-800" />
              <div className="h-4 w-10 animate-pulse rounded bg-neutral-800" />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
